/**
 * Durable storage for the in-memory file system's persisted roots.
 *
 *   /data     learning data: chats, graph, settings, prompts, plugin data
 *   /private  API keys and subscription credentials (auth.json and friends)
 *
 * On iPad both are real files. /data is the app's Documents folder, which
 * shows in the Files app (On My iPad › LearnHarness) and is included in
 * device backups, so learning records stay inspectable plain files as on
 * desktop. /private is Library/LearnHarness: backed up, but not shown in
 * Files, so keys aren't one tap away for anyone holding the iPad.
 *
 * In a desktop browser (development) both roots live in IndexedDB.
 *
 * Boot restores every file before any server module loads. After that,
 * writes schedule a debounced sync that stores changed files and deletes
 * removed ones; leaving the app (pagehide / hidden) flushes at once.
 *
 * The first native launch moves data saved in IndexedDB by earlier builds
 * into the files, then clears IndexedDB.
 */
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Buffer } from "../shims/node/buffer.ts";
import { vol, setWriteHook } from "../shims/node/fs.ts";
import { DATA_ROOT, PRIVATE_ROOT } from "./node-globals.ts";

export const PERSISTED_ROOTS = [DATA_ROOT, PRIVATE_ROOT] as const;

type Entry = { path: string; data: Uint8Array; mtimeMs: number };

interface Backend {
	readonly name: string;
	load(): Promise<Entry[]>;
	put(entries: Entry[]): Promise<void>;
	remove(paths: string[]): Promise<void>;
}

// ── IndexedDB (desktop browsers, and the pre-files iPad builds) ──

const LEGACY_DB = "learnharness";
const STORE = "files";

function openDb(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(name, 1);
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

function indexedDbBackend(name = LEGACY_DB): Backend & { clear(): Promise<void> } {
	let db: Promise<IDBDatabase> | null = null;
	const get = () => (db ??= openDb(name));
	return {
		name: "IndexedDB",
		async load() {
			const tx = (await get()).transaction(STORE, "readonly");
			return new Promise<Entry[]>((resolve, reject) => {
				const req = tx.objectStore(STORE).getAll();
				req.onsuccess = () => resolve(req.result as Entry[]);
				req.onerror = () => reject(req.error);
			});
		},
		async put(entries) {
			const tx = (await get()).transaction(STORE, "readwrite");
			for (const entry of entries) tx.objectStore(STORE).put(entry);
			await done(tx);
		},
		async remove(paths) {
			const tx = (await get()).transaction(STORE, "readwrite");
			for (const path of paths) tx.objectStore(STORE).delete(path);
			await done(tx);
		},
		async clear() {
			const tx = (await get()).transaction(STORE, "readwrite");
			tx.objectStore(STORE).clear();
			await done(tx);
		},
	};
}

// ── Files (iPad) ──

type Place = { directory: Directory; path: string };

/** Where a virtual path lives on the device. */
function place(virtualPath: string): Place {
	if (virtualPath === DATA_ROOT || virtualPath.startsWith(`${DATA_ROOT}/`)) {
		return { directory: Directory.Documents, path: virtualPath.slice(DATA_ROOT.length + 1) };
	}
	if (virtualPath === PRIVATE_ROOT || virtualPath.startsWith(`${PRIVATE_ROOT}/`)) {
		return { directory: Directory.Library, path: `LearnHarness${virtualPath.slice(PRIVATE_ROOT.length)}` };
	}
	throw new Error(`Not a persisted path: ${virtualPath}`);
}

function filesBackend(): Backend {
	async function walk(virtualDir: string, out: Entry[]): Promise<void> {
		const at = place(virtualDir);
		let listing;
		try { listing = await Filesystem.readdir({ directory: at.directory, path: at.path }); }
		catch { return; } // Not created yet.
		for (const info of listing.files) {
			const virtualPath = `${virtualDir}/${info.name}`;
			if (info.type === "directory") { await walk(virtualPath, out); continue; }
			const { data } = await Filesystem.readFile({ directory: at.directory, path: at.path ? `${at.path}/${info.name}` : info.name });
			const bytes = typeof data === "string" ? new Uint8Array(Buffer.from(data, "base64")) : new Uint8Array(await data.arrayBuffer());
			out.push({ path: virtualPath, data: bytes, mtimeMs: Number(info.mtime) || Date.now() });
		}
	}
	return {
		name: "Files",
		async load() {
			const out: Entry[] = [];
			for (const root of PERSISTED_ROOTS) await walk(root, out);
			return out;
		},
		async put(entries) {
			for (const entry of entries) {
				const at = place(entry.path);
				await Filesystem.writeFile({ ...at, data: Buffer.from(entry.data).toString("base64"), recursive: true });
			}
		},
		async remove(paths) {
			for (const path of paths) {
				try { await Filesystem.deleteFile(place(path)); }
				catch { /* already gone */ }
			}
		},
	};
}

// ── Sync engine ──

let backend: Backend | null = null;
/** path → mtimeMs:size of what the backend currently holds. */
const persisted = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let syncing: Promise<void> | null = null;
let again = false;

const signature = (path: string) => { const st = vol.statSync(path); return `${st.mtimeMs}:${st.size}`; };

function install(entries: Entry[]): void {
	for (const entry of entries) {
		vol.mkdirSync(entry.path.slice(0, entry.path.lastIndexOf("/")), { recursive: true });
		vol.writeFileSync(entry.path, entry.data);
		const when = new Date(entry.mtimeMs);
		vol.utimesSync(entry.path, when, when);
		persisted.set(entry.path, signature(entry.path));
	}
}

/** Load every saved file into the volume. Call once, before server code.
 *  Returns the backend used and how many files it restored. */
export async function restore(): Promise<{ backend: string; files: number; migrated: number }> {
	for (const root of PERSISTED_ROOTS) vol.mkdirSync(root, { recursive: true });
	let migrated = 0;
	// ?lh-files-backend runs the iPad's files path in a desktop browser, on
	// @capacitor/filesystem's web implementation (dev checks only).
	const files = Capacitor.isNativePlatform() || new URLSearchParams(location.search).has("lh-files-backend");
	if (files) {
		backend = filesBackend();
		let entries = await backend.load();
		if (entries.length === 0) {
			// Earlier iPad builds kept everything in IndexedDB: move it over once.
			const legacy = indexedDbBackend(LEGACY_DB);
			const old = (await legacy.load()).filter((e) => PERSISTED_ROOTS.some((r) => e.path.startsWith(`${r}/`)))
				.map((e) => (e.path === `${DATA_ROOT}/auth.json` || /^\/data\/[a-z-]+-credentials\.json/.test(e.path)
					? { ...e, path: `${PRIVATE_ROOT}${e.path.slice(DATA_ROOT.length)}` } // secrets → /private
					: e));
			if (old.length) {
				await backend.put(old);
				await legacy.clear();
				entries = old;
				migrated = old.length;
			}
		}
		install(entries);
	} else {
		backend = indexedDbBackend();
		install(await backend.load());
	}
	setWriteHook(schedule);
	addEventListener("pagehide", () => void flush());
	document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flush(); });
	return { backend: backend.name, files: persisted.size, migrated };
}

function walkVolume(dir: string, out: Map<string, string>): void {
	let names: string[];
	try { names = vol.readdirSync(dir) as string[]; } catch { return; }
	for (const name of names) {
		const full = `${dir}/${name}`;
		const st = vol.lstatSync(full);
		if (st.isDirectory()) walkVolume(full, out);
		else if (st.isFile()) out.set(full, `${st.mtimeMs}:${st.size}`);
	}
}

async function syncOnce(): Promise<void> {
	if (!backend) return;
	const now = new Map<string, string>();
	for (const root of PERSISTED_ROOTS) walkVolume(root, now);
	const changed: Entry[] = [];
	for (const [path, sig] of now) {
		if (persisted.get(path) === sig) continue;
		changed.push({ path, data: new Uint8Array(vol.readFileSync(path) as Uint8Array), mtimeMs: Number(sig.split(":")[0]) });
	}
	const removed = [...persisted.keys()].filter((p) => !now.has(p));
	if (!changed.length && !removed.length) return;
	await backend.put(changed);
	await backend.remove(removed);
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
