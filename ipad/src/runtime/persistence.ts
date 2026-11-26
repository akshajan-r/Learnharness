/**
 * Durable storage for the learning-data root (/data) of the in-memory file
 * system.
 *
 * Every file under /data is mirrored into IndexedDB as one record per path
 * (bytes + mtime). Boot restores them before any server module loads; after
 * that, writes schedule a debounced sync that stores changed files and drops
 * deleted ones, and leaving the app (pagehide / hidden) flushes at once.
 *
 * Phase 1 swaps IndexedDB for files in the app's Documents folder (visible
 * in the Files app, included in iCloud/iTunes backups). The interface here
 * — restore() then schedule()/flush() — stays the same.
 */
import { vol, setWriteHook } from "../shims/node/fs.ts";
import { DATA_ROOT } from "./node-globals.ts";

const DB_NAME = "learnharness";
const STORE = "files";

type Entry = { path: string; data: Uint8Array; mtimeMs: number };

let db: IDBDatabase | null = null;
/** path → mtimeMs+size of what IndexedDB currently holds. */
const persisted = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let syncing: Promise<void> | null = null;
let again = false;

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "path" });
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function done(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
	});
}

/** Load every saved file into the volume. Call once, before server code. */
export async function restore(): Promise<number> {
	db = await open();
	const tx = db.transaction(STORE, "readonly");
	const all = await new Promise<Entry[]>((resolve, reject) => {
		const req = tx.objectStore(STORE).getAll();
		req.onsuccess = () => resolve(req.result as Entry[]);
		req.onerror = () => reject(req.error);
	});
	vol.mkdirSync(DATA_ROOT, { recursive: true });
	for (const entry of all) {
		const dir = entry.path.slice(0, entry.path.lastIndexOf("/"));
		vol.mkdirSync(dir, { recursive: true });
		vol.writeFileSync(entry.path, entry.data);
		const when = new Date(entry.mtimeMs);
		vol.utimesSync(entry.path, when, when);
		persisted.set(entry.path, `${entry.mtimeMs}:${entry.data.byteLength}`);
	}
	setWriteHook(schedule);
	addEventListener("pagehide", () => void flush());
	document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flush(); });
	return all.length;
}

function walk(dir: string, out: Map<string, string>): void {
	let names: string[];
	try { names = vol.readdirSync(dir) as string[]; } catch { return; }
	for (const name of names) {
		const full = `${dir}/${name}`;
		const st = vol.lstatSync(full);
		if (st.isDirectory()) walk(full, out);
		else if (st.isFile()) out.set(full, `${st.mtimeMs}:${st.size}`);
	}
}

async function syncOnce(): Promise<void> {
	if (!db) return;
	const now = new Map<string, string>();
	walk(DATA_ROOT, now);
	const changed: Entry[] = [];
	for (const [path, sig] of now) {
		if (persisted.get(path) === sig) continue;
		const data = vol.readFileSync(path) as Uint8Array;
		changed.push({ path, data: new Uint8Array(data), mtimeMs: Number(sig.split(":")[0]) });
	}
	const removed = [...persisted.keys()].filter((p) => !now.has(p));
	if (!changed.length && !removed.length) return;
	const tx = db.transaction(STORE, "readwrite");
	const store = tx.objectStore(STORE);
	for (const entry of changed) store.put(entry);
	for (const path of removed) store.delete(path);
	await done(tx);
	for (const entry of changed) persisted.set(entry.path, now.get(entry.path)!);
	for (const path of removed) persisted.delete(path);
}

/** Write everything pending now. Safe to call repeatedly. */
export async function flush(): Promise<void> {
	if (timer) { clearTimeout(timer); timer = null; }
	if (syncing) { again = true; return syncing; }
	syncing = (async () => {
		try {
			do { again = false; await syncOnce(); } while (again);
		} catch (error) {
			console.error("[persistence] saving learning data failed", error);
		} finally {
			syncing = null;
		}
	})();
	return syncing;
}

export function schedule(): void {
	if (timer) return;
	timer = setTimeout(() => { timer = null; void flush(); }, 50);
}
