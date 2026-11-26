/**
 * Node globals the LearnHarness server code reads. Imported first, before
 * any server module, so module-level `process.env` reads see these values.
 */
import { Buffer } from "../shims/node/buffer.ts";

/** Learning data (Documents on iPad: visible in the Files app). */
export const DATA_ROOT = "/data";
/** Keys and subscription credentials (Library on iPad: not in Files). */
export const PRIVATE_ROOT = "/private";
/** Read-only files that ship with the app (prompts). */
export const APP_ROOT = "/app";

type ProcessShim = {
	env: Record<string, string | undefined>;
	platform: string;
	versions: Record<string, string>;
	pid: number;
	argv: string[];
	execPath: string;
	connected: boolean;
	cwd(): string;
	on(): ProcessShim;
	off(): ProcessShim;
	once(): ProcessShim;
	emitWarning(message: unknown): void;
	nextTick(fn: (...args: unknown[]) => void, ...args: unknown[]): void;
	hrtime: { bigint(): bigint };
	memoryUsage(): { rss: number; heapUsed: number; heapTotal: number };
	exit(): never;
	kill(): boolean;
	send?: undefined;
};

const g = globalThis as unknown as { process?: ProcessShim; Buffer?: typeof Buffer; global?: typeof globalThis };

const proc: ProcessShim = {
	env: {
		NODE_ENV: "production",
		LH_DATA_DIR: DATA_ROOT,
		LH_AUTH_FILE: `${PRIVATE_ROOT}/auth.json`,
		LH_PLATFORM: "ipad",
		NEXT_RUNTIME: "nodejs",
	},
	platform: "ios",
	versions: {},
	pid: 1,
	argv: [],
	execPath: "",
	connected: false,
	cwd: () => APP_ROOT,
	on() { return proc; },
	off() { return proc; },
	once() { return proc; },
	emitWarning(message) { console.warn("[process warning]", message); },
	nextTick(fn, ...args) { queueMicrotask(() => fn(...args)); },
	hrtime: { bigint: () => BigInt(Math.round(performance.now() * 1e6)) },
	memoryUsage: () => ({ rss: 0, heapUsed: 0, heapTotal: 0 }),
	exit() { throw new Error("process.exit is not available on iPad"); },
	kill() { return false; },
};

g.process = proc;
g.Buffer ??= Buffer;
g.global ??= globalThis;
