/**
 * Chat + knowledge-graph sync between this iPad and the desktop app on the
 * paired laptop (through the bridge's sync hub, ipad/bridge/sync-hub.ts).
 *
 * Each device keeps its full local data. A sync compares both sides with the
 * base saved at the last successful sync (/private/sync-base.json):
 *   - chats: whole files. One side changed → copy it; deleted on one side and
 *     untouched on the other → delete; changed on both → the newer
 *     (updatedAt) wins under the original id and the other is kept as a
 *     separate "… (conflict copy)" session on both devices.
 *   - graph ledgers (*.jsonl): three-way line merge (additions from both,
 *     removals from either); source documents: three-way JSON merge.
 *     Only when both sides use the same graph format.
 * Chats with a running turn or compaction here are left for a later round;
 * hub-side compare-and-swap conflicts are retried next round too.
 */
import { createHash, randomUUID } from "../shims/node/crypto.ts";
import { vol } from "../shims/node/fs.ts";
import { DATA_ROOT, PRIVATE_ROOT } from "../runtime/node-globals.ts";
import { flush } from "../runtime/persistence.ts";
import { bridgeConfig, bridgeFetch, BridgeUnavailableError } from "../runtime/bridge.ts";
import { decideFile, ledgerLines, mergeJson, mergeLedger } from "./merge.ts";

const LEDGERS = ["graph/nodes.jsonl", "graph/chains.jsonl", "graph/sessions.jsonl", "graph/coverage.jsonl"];
const DOCUMENTS = ["graph/sources.json", "graph/source-organization.json"];
const FORMAT = "graph/format.json";
const BASE_FILE = `${PRIVATE_ROOT}/sync-base.json`;
const CHAT_NAME = /^([A-Za-z0-9_-]{1,120})\.json$/;

type Base = { chats: Record<string, string>; files: Record<string, string>; ledgers: Record<string, string[]>; documents: Record<string, unknown> };
type RemoteState = { root: string; chats: Record<string, { hash: string; updatedAt: string | null }>; files: Record<string, string>; format: string | null };
type Change = { path: string; text: string | null; expect: string | null };

export type SyncReport = { ok: true; chatsIn: number; chatsOut: number; conflicts: number; graph: "merged" | "unchanged" | "skipped"; retry: number } | { ok: false; reason: string; quiet: boolean };

const sha = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex") as string;
const abs = (rel: string) => `${DATA_ROOT}/${rel}`;

function readText(rel: string): string | undefined {
	try { return vol.readFileSync(abs(rel), "utf8") as string; } catch { return undefined; }
}
function writeText(rel: string, text: string): void {
	vol.mkdirSync(abs(rel).slice(0, abs(rel).lastIndexOf("/")), { recursive: true });
	vol.writeFileSync(abs(rel), text);
}
function removeFile(rel: string): void {
	try { vol.unlinkSync(abs(rel)); } catch { /* already gone */ }
}

function loadBase(): Base {
	try {
		const raw = JSON.parse(vol.readFileSync(BASE_FILE, "utf8") as string) as Partial<Base>;
		return { chats: raw.chats ?? {}, files: raw.files ?? {}, ledgers: raw.ledgers ?? {}, documents: raw.documents ?? {} };
	} catch {
		return { chats: {}, files: {}, ledgers: {}, documents: {} };
	}
}
function saveBase(base: Base): void {
	vol.mkdirSync(PRIVATE_ROOT, { recursive: true });
	vol.writeFileSync(BASE_FILE, JSON.stringify(base));
}

async function api<T>(path: string, body?: unknown): Promise<T> {
	const res = await bridgeFetch(path, body === undefined
		? { signal: AbortSignal.timeout(20_000) }
		: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
	if (res.status === 404) throw new BridgeUnavailableError("The laptop bridge is an older version without sync. Restart `npm run bridge` after updating the learnharness folder.");
	if (!res.ok) throw new Error(`The laptop bridge answered HTTP ${res.status} during sync.`);
	return (await res.json()) as T;
}

function localChats(): Record<string, string> {
	const out: Record<string, string> = {};
	let names: string[] = [];
	try { names = vol.readdirSync(abs("chats")) as string[]; } catch { /* none */ }
	for (const name of names) {
		const match = CHAT_NAME.exec(name);
		if (!match) continue;
		out[match[1]!] = sha(vol.readFileSync(abs(`chats/${name}`)) as Uint8Array);
	}
	return out;
}

function updatedAt(text: string | undefined): number {
	try { return Date.parse((JSON.parse(text ?? "") as { updatedAt?: string }).updatedAt ?? "") || 0; } catch { return 0; }
}

/** A conflict's losing version, as a separate session. */
function conflictCopy(text: string): { id: string; text: string } {
	const record = JSON.parse(text) as { id: string; title?: string };
	const id = `chat_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
	record.id = id;
	record.title = `${record.title ?? "Untitled session"} (conflict copy)`;
	return { id, text: JSON.stringify(record, null, "\t") };
}

let running: Promise<SyncReport> | null = null;

export function syncNow(): Promise<SyncReport> {
	running ??= syncOnce().finally(() => { running = null; });
	return running;
}

async function syncOnce(): Promise<SyncReport> {
	if (!bridgeConfig()) return { ok: false, reason: "not paired", quiet: true };
	const server = await import("@/src/server");
	const { emit } = await import("@/src/core/events.ts");
	let remote: RemoteState;
	try {
		remote = await api<RemoteState>("/v1/sync/state");
	} catch (error) {
		const quiet = error instanceof BridgeUnavailableError && !/older version/.test(error.message);
		return { ok: false, reason: (error as Error).message, quiet };
	}

	const base = loadBase();
	// Each push carries the base update to make once the hub accepts it.
	const pending: Array<{ change: Change; onApplied: () => void }> = [];
	const push = (change: Change, onApplied: () => void) => { pending.push({ change, onApplied }); };
	const changedHere = new Set<string>();
	let chatsIn = 0, chatsOut = 0, conflicts = 0;

	// ── Chats ──
	const local = localChats();
	const ids = new Set([...Object.keys(local), ...Object.keys(remote.chats), ...Object.keys(base.chats)]);
	const decisions = new Map<string, ReturnType<typeof decideFile>>();
	for (const id of ids) {
		if (server.isTurnRunning(id) || server.compactionInFlight(id)) continue;
		decisions.set(id, decideFile(base.chats[id], local[id], remote.chats[id]?.hash));
	}
	const needRemote = [...decisions].filter(([, d]) => d.kind === "download" || d.kind === "conflict").map(([id]) => `chats/${id}.json`);
	const remoteTexts = needRemote.length ? await api<Record<string, string | null>>("/v1/sync/get", { paths: needRemote }) : {};

	for (const [id, decision] of decisions) {
		const rel = `chats/${id}.json`;
		const remoteHash = remote.chats[id]?.hash ?? null;
		switch (decision.kind) {
			case "same":
				if (local[id] === undefined) delete base.chats[id]; else base.chats[id] = local[id]!;
				break;
			case "upload": {
				const text = readText(rel)!;
				push({ path: rel, text, expect: remoteHash }, () => { base.chats[id] = local[id]!; });
				chatsOut++;
				break;
			}
			case "delete-remote":
				push({ path: rel, text: null, expect: remoteHash }, () => { delete base.chats[id]; });
				chatsOut++;
				break;
			case "download": {
				const text = remoteTexts[rel];
				if (text == null) break; // vanished meanwhile: next round
				writeText(rel, text);
				base.chats[id] = sha(text);
				changedHere.add(id);
				chatsIn++;
				break;
			}
			case "delete-local":
				removeFile(rel);
				delete base.chats[id];
				changedHere.add(id);
				chatsIn++;
				break;
			case "conflict": {
				const mine = readText(rel);
				const theirs = remoteTexts[rel];
				if (mine === undefined || theirs == null) break;
				const localWins = updatedAt(mine) >= updatedAt(theirs);
				const copy = conflictCopy(localWins ? theirs : mine);
				// The copy exists on both devices; the winner takes the id everywhere.
				writeText(`chats/${copy.id}.json`, copy.text);
				push({ path: `chats/${copy.id}.json`, text: copy.text, expect: null }, () => { base.chats[copy.id] = sha(copy.text); });
				if (localWins) {
					push({ path: rel, text: mine, expect: remoteHash }, () => { base.chats[id] = sha(mine); });
				} else {
					writeText(rel, theirs);
					base.chats[id] = sha(theirs);
				}
				changedHere.add(id).add(copy.id);
				conflicts++;
				break;
			}
		}
	}

	// ── Knowledge graph ──
	let graph: "merged" | "unchanged" | "skipped" = "unchanged";
	const localFormat = readText(FORMAT);
	const sameFormat = (a: string | null | undefined, b: string | null | undefined) => {
		const version = (t: string | null | undefined) => { try { return (JSON.parse(t ?? "") as { version?: number }).version ?? null; } catch { return null; } };
		return !a || !b || version(a) === version(b);
	};
	if (!sameFormat(localFormat, remote.format)) {
		graph = "skipped";
	} else {
		if (localFormat && !remote.format) push({ path: FORMAT, text: localFormat, expect: null }, () => {});
		if (!localFormat && remote.format) writeText(FORMAT, remote.format);
		const graphFiles = [...LEDGERS, ...DOCUMENTS];
		const stale = graphFiles.filter((rel) => {
			const localText = readText(rel);
			const localHash = localText === undefined ? undefined : sha(localText);
			return localHash !== remote.files[rel] && !(localHash === base.files[rel] && remote.files[rel] === base.files[rel]);
		});
		const fetched = stale.length ? await api<Record<string, string | null>>("/v1/sync/get", { paths: stale.filter((rel) => remote.files[rel]) }) : {};
		for (const rel of stale) {
			const localText = readText(rel) ?? "";
			const remoteText = fetched[rel] ?? "";
			let merged: string;
			let record: () => void;
			if (LEDGERS.includes(rel)) {
				const lines = mergeLedger(new Set(base.ledgers[rel] ?? []), ledgerLines(localText), ledgerLines(remoteText), sha);
				merged = lines.length ? `${lines.join("\n")}\n` : "";
				record = () => { base.ledgers[rel] = lines.map(sha); base.files[rel] = sha(merged); };
			} else {
				const parse = (t: string) => { try { return t ? JSON.parse(t) as unknown : undefined; } catch { return undefined; } };
				const value = mergeJson(base.documents[rel], parse(localText), parse(remoteText), true);
				merged = value === undefined ? "" : `${JSON.stringify(value, null, "\t")}\n`;
				record = () => { base.documents[rel] = value; base.files[rel] = sha(merged); };
			}
			if (merged !== localText && merged) { writeText(rel, merged); graph = "merged"; }
			// The base moves only once both sides hold the merged file.
			if (merged !== remoteText && merged) push({ path: rel, text: merged, expect: remote.files[rel] ?? null }, record);
			else record();
		}
		// Files equal on both sides become the base as they are.
		for (const rel of graphFiles) {
			if (stale.includes(rel)) continue;
			const text = readText(rel);
			if (text === undefined) continue;
			base.files[rel] = sha(text);
			if (LEDGERS.includes(rel)) base.ledgers[rel] = ledgerLines(text).map(sha);
			else { try { base.documents[rel] = JSON.parse(text); } catch { /* leave */ } }
		}
	}

	// ── Push, then record what the hub accepted ──
	let retry = 0;
	if (pending.length) {
		const result = await api<{ applied: string[]; conflicts: string[] }>("/v1/sync/put", { changes: pending.map((p) => p.change) });
		const accepted = new Set(result.applied);
		retry = result.conflicts.length;
		for (const { change, onApplied } of pending) if (accepted.has(change.path)) onApplied();
	}
	saveBase(base);
	await flush();

	if (changedHere.size) {
		emit("chats-changed", {});
		for (const id of changedHere) emit("record-changed", { chatId: id });
	}
	if (graph === "merged") emit("sources-changed", {});
	return { ok: true, chatsIn, chatsOut, conflicts, graph, retry };
}
