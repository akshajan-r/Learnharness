/**
 * The laptop side of chat + knowledge-graph sync: the desktop app's own
 * learning-data folder, served to the paired iPad through the bridge.
 *
 * Stateless: the iPad keeps the last-synced base and does the merging; the
 * hub reports what it has (sha-256 per file), hands out contents, and
 * applies writes/deletes only if the file still has the hash the iPad last
 * saw (a compare-and-swap), so a change the desktop app made meanwhile is
 * reported as a conflict instead of being overwritten. Writes are atomic
 * (temp file + rename).
 *
 * Only these paths, relative to the data folder, are touched:
 *   chats/<id>.json, graph/{nodes,chains,sessions,coverage}.jsonl,
 *   graph/sources.json, graph/source-organization.json
 * graph/format.json is read (format guard) and written only if absent.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SYNC_LEDGERS = ["graph/nodes.jsonl", "graph/chains.jsonl", "graph/sessions.jsonl", "graph/coverage.jsonl"] as const;
export const SYNC_DOCUMENTS = ["graph/sources.json", "graph/source-organization.json"] as const;
const FORMAT_FILE = "graph/format.json";
const CHAT_FILE = /^chats\/([A-Za-z0-9_-]{1,120})\.json$/;

/** The installed desktop app's data folder (electron/main.cjs: userData/data). */
export function desktopDataDir(): string {
	if (process.env.LH_SYNC_DATA_DIR) return path.resolve(process.env.LH_SYNC_DATA_DIR);
	const home = os.homedir();
	const userData = process.platform === "win32" ? path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "LearnHarness")
		: process.platform === "darwin" ? path.join(home, "Library", "Application Support", "LearnHarness")
		: path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "LearnHarness");
	return path.join(userData, "data");
}

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

function allowed(rel: string): boolean {
	return CHAT_FILE.test(rel) || (SYNC_LEDGERS as readonly string[]).includes(rel) || (SYNC_DOCUMENTS as readonly string[]).includes(rel) || rel === FORMAT_FILE;
}

export class SyncHub {
	constructor(readonly root: string) {}

	#abs(rel: string): string {
		if (!allowed(rel)) throw new Error(`Not a synced path: ${rel}`);
		return path.join(this.root, ...rel.split("/"));
	}

	#read(rel: string): Buffer | undefined {
		try { return fs.readFileSync(this.#abs(rel)); } catch { return undefined; }
	}

	state() {
		const chats: Record<string, { hash: string; updatedAt: string | null }> = {};
		let names: string[] = [];
		try { names = fs.readdirSync(path.join(this.root, "chats")); } catch { /* none yet */ }
		for (const name of names) {
			const rel = `chats/${name}`;
			const match = CHAT_FILE.exec(rel);
			if (!match) continue;
			const bytes = this.#read(rel);
			if (!bytes) continue;
			let updatedAt: string | null = null;
			try { updatedAt = (JSON.parse(bytes.toString("utf8")) as { updatedAt?: string }).updatedAt ?? null; } catch { /* unreadable chat: still listed */ }
			chats[match[1]!] = { hash: sha(bytes), updatedAt };
		}
		const files: Record<string, string> = {};
		for (const rel of [...SYNC_LEDGERS, ...SYNC_DOCUMENTS]) {
			const bytes = this.#read(rel);
			if (bytes) files[rel] = sha(bytes);
		}
		const format = this.#read(FORMAT_FILE)?.toString("utf8") ?? null;
		return { root: this.root, chats, files, format };
	}

	get(paths: string[]): Record<string, string | null> {
		const out: Record<string, string | null> = {};
		for (const rel of paths) out[rel] = this.#read(rel)?.toString("utf8") ?? null;
		return out;
	}

	/** Compare-and-swap writes/deletes. `expect` null = must be absent. */
	put(changes: Array<{ path: string; text: string | null; expect: string | null }>) {
		const applied: string[] = [];
		const conflicts: string[] = [];
		for (const change of changes) {
			const abs = this.#abs(change.path);
			const current = this.#read(change.path);
			const currentHash = current ? sha(current) : null;
			if (change.path === FORMAT_FILE ? current !== undefined : currentHash !== change.expect) {
				conflicts.push(change.path);
				continue;
			}
			if (change.text === null) {
				fs.rmSync(abs, { force: true });
			} else {
				fs.mkdirSync(path.dirname(abs), { recursive: true });
				const temp = `${abs}.sync-${randomUUID()}`;
				fs.writeFileSync(temp, change.text, "utf8");
				fs.renameSync(temp, abs);
			}
			applied.push(change.path);
		}
		return { applied, conflicts };
	}
}
