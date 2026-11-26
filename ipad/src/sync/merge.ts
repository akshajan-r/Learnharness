/**
 * Three-way merges for sync (pure; no I/O). "base" is the content both sides
 * agreed on at the last successful sync; "local" and "remote" are the two
 * devices now. Changes made on either side since base survive; where both
 * changed the same thing differently, `preferLocal` decides.
 */

/** sha-256 hex of text, injected so this module stays environment-free. */
export type Hasher = (text: string) => string;

// ── Append-only JSONL ledgers (graph/*.jsonl) ──

export function ledgerLines(text: string): string[] {
	return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * Lines are records. A line present on one side but not in base was added
 * there; a line in base but missing on one side was removed there (graph
 * deletions and simplification rewrite ledgers). Result: local's lines in
 * local order minus remote removals, then remote's additions in remote
 * order — so a record's first (defining) line still precedes its appends.
 */
export function mergeLedger(base: ReadonlySet<string>, local: readonly string[], remote: readonly string[], hash: Hasher): string[] {
	const localSet = new Set(local.map(hash));
	const remoteSet = new Set(remote.map(hash));
	const out: string[] = [];
	const seen = new Set<string>();
	for (const line of local) {
		const h = hash(line);
		if (seen.has(h)) continue;
		if (base.has(h) && !remoteSet.has(h)) continue; // removed remotely
		seen.add(h);
		out.push(line);
	}
	for (const line of remote) {
		const h = hash(line);
		if (seen.has(h) || localSet.has(h)) continue;
		if (base.has(h)) continue; // removed locally
		seen.add(h);
		out.push(line);
	}
	return out;
}

// ── JSON documents (graph/sources.json, graph/source-organization.json) ──

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isObject = (v: unknown): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);
const isIdList = (v: unknown): v is Array<Record<string, Json> & { id: string }> =>
	Array.isArray(v) && v.every((item) => isObject(item) && typeof item.id === "string");

export function jsonEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
	if (isObject(a) && isObject(b)) {
		const ka = Object.keys(a), kb = Object.keys(b);
		return ka.length === kb.length && ka.every((k) => k in b && jsonEqual(a[k], b[k]));
	}
	return false;
}

/** `undefined` means "absent". Objects merge per key; arrays of {id}
 *  objects merge per id (order: local, then remote-only additions); other
 *  values take whichever side changed, or `preferLocal` if both did. */
export function mergeJson(base: unknown, local: unknown, remote: unknown, preferLocal: boolean): unknown {
	if (jsonEqual(local, remote)) return local;
	if (jsonEqual(base, local)) return remote;
	if (jsonEqual(base, remote)) return local;
	if (isObject(local) && isObject(remote)) {
		const b = isObject(base) ? base : {};
		const out: Record<string, unknown> = {};
		for (const key of new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(b)])) {
			const merged = mergeJson(b[key], local[key], remote[key], preferLocal);
			if (merged !== undefined) out[key] = merged;
		}
		return out;
	}
	if (isIdList(local) && isIdList(remote)) {
		const byId = (list: Array<{ id: string }>) => new Map(list.map((item) => [item.id, item]));
		const b = byId(isIdList(base) ? base : []), l = byId(local), r = byId(remote);
		const out: unknown[] = [];
		const ids = [...local.map((x) => x.id), ...remote.map((x) => x.id).filter((id) => !l.has(id))];
		for (const id of ids) {
			const merged = mergeJson(b.get(id), l.get(id), r.get(id), preferLocal);
			if (merged !== undefined) out.push(merged);
		}
		return out;
	}
	return preferLocal ? local : remote;
}

// ── Whole files (chats) ──

export type FileAction =
	| { kind: "same" }
	| { kind: "upload" }            // local → remote
	| { kind: "download" }          // remote → local
	| { kind: "delete-remote" }
	| { kind: "delete-local" }
	| { kind: "conflict" };         // both changed: newest wins, the other becomes a copy

/** Decide one file from hashes (undefined = absent). */
export function decideFile(base: string | undefined, local: string | undefined, remote: string | undefined): FileAction {
	if (local === remote) return { kind: "same" };
	if (local === base) return remote === undefined ? { kind: "delete-local" } : { kind: "download" };
	if (remote === base) return local === undefined ? { kind: "delete-remote" } : { kind: "upload" };
	// Both sides moved away from base.
	if (local === undefined) return { kind: "download" }; // deleted here, edited there: keep the edit
	if (remote === undefined) return { kind: "upload" };  // edited here, deleted there: keep the edit
	return { kind: "conflict" };
}
