/**
 * node:fs for the iPad runtime.
 *
 * The LearnHarness stores use synchronous fs calls, so the whole tree lives
 * in an in-memory memfs volume. Writes under the persisted data root are
 * mirrored to durable storage by ../../runtime/persistence.ts, which also
 * restores the volume before any server module is imported.
 */
import { Volume, createFsFromVolume } from "memfs";

export const vol = new Volume();
const fs = createFsFromVolume(vol) as unknown as typeof import("node:fs");

/** Called after every mutating fs call (sync, callback or promise form). */
let onWrite: () => void = () => {};
export function setWriteHook(hook: () => void): void { onWrite = hook; }

const MUTATING = [
	"writeFile", "appendFile", "write", "close", "rename", "unlink", "rm", "rmdir", "mkdir",
	"copyFile", "truncate", "ftruncate", "utimes", "futimes", "symlink", "link", "mkdtemp",
] as const;

function wrap(target: Record<string, unknown>, name: string): void {
	const original = target[name];
	if (typeof original !== "function") return;
	target[name] = function (this: unknown, ...args: unknown[]) {
		try {
			const result = (original as (...a: unknown[]) => unknown).apply(this, args);
			if (result && typeof (result as Promise<unknown>).then === "function") {
				return (result as Promise<unknown>).finally(() => onWrite());
			}
			return result;
		} finally {
			onWrite();
		}
	};
}
for (const name of MUTATING) {
	wrap(fs as unknown as Record<string, unknown>, name);
	wrap(fs as unknown as Record<string, unknown>, `${name}Sync`);
	wrap(fs.promises as unknown as Record<string, unknown>, name);
}

export default fs;

export const {
	accessSync,
	appendFileSync,
	chmodSync,
	closeSync,
	copyFileSync,
	createReadStream,
	createWriteStream,
	existsSync,
	fstatSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	readSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	rmdirSync,
	statSync,
	symlinkSync,
	truncateSync,
	unlinkSync,
	utimesSync,
	watch,
	writeFileSync,
	writeSync,
	access,
	appendFile,
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	stat,
	unlink,
	writeFile,
	promises,
	constants,
	Stats,
	Dirent,
} = fs;
