/**
 * Small node:* modules for the iPad runtime. Anything that would launch a
 * process, open a socket server or start a Node worker is unavailable on
 * iPadOS and fails loudly; the laptop bridge (phase 2) takes over those jobs.
 */

export class IpadUnavailableError extends Error {
	constructor(what: string) {
		super(`${what} is not available on iPad`);
		this.name = "IpadUnavailableError";
	}
}

const unavailable = (what: string) => () => { throw new IpadUnavailableError(what); };

// ── node:os ──
/** The learner's home folder: attached files live here (in the Files app:
 *  On My iPad › LearnHarness › Attachments), so the agent's file tools
 *  default to them. */
export const HOME = "/data/Attachments";
export const os = {
	homedir: () => HOME,
	tmpdir: () => "/tmp",
	platform: () => "ios",
	type: () => "Darwin",
	arch: () => "arm64",
	release: () => "",
	hostname: () => "ipad",
	EOL: "\n",
	cpus: () => [],
	totalmem: () => 0,
	freemem: () => 0,
	userInfo: () => ({ username: "learner", homedir: HOME, shell: null, uid: -1, gid: -1 }),
};

// ── node:url ──
export function fileURLToPath(url: string | URL): string {
	const u = typeof url === "string" ? new URL(url) : url;
	if (u.protocol !== "file:") throw new TypeError(`fileURLToPath: not a file URL: ${u.href}`);
	return decodeURIComponent(u.pathname);
}
export function pathToFileURL(p: string): URL {
	return new URL(`file://${encodeURI(p)}`);
}

// ── node:async_hooks ──
// No async context propagation exists in a web view. Each run() keeps its
// store for the synchronous call and for the promise it returns; concurrent
// overlapping runs see the most recent store. Good enough for the capture
// helpers that use it; revisit if a concurrency bug traces back here.
export class AsyncLocalStorage<T> {
	#store: T | undefined;
	getStore(): T | undefined { return this.#store; }
	run<R>(store: T, fn: (...args: unknown[]) => R, ...args: unknown[]): R {
		const previous = this.#store;
		this.#store = store;
		let result: R;
		try { result = fn(...args); }
		catch (error) { this.#store = previous; throw error; }
		if (result && typeof (result as { finally?: unknown }).finally === "function") {
			return (result as unknown as Promise<unknown>).finally(() => { if (this.#store === store) this.#store = previous; }) as R;
		}
		this.#store = previous;
		return result;
	}
	enterWith(store: T): void { this.#store = store; }
	disable(): void { this.#store = undefined; }
}

// ── node:util (only isDeepStrictEqual is imported directly by LearnHarness;
//    dependencies get the `util` npm polyfill) ──
export function isDeepStrictEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
	if (Array.isArray(a)) {
		const bb = b as unknown[];
		return a.length === bb.length && a.every((v, i) => isDeepStrictEqual(v, bb[i]));
	}
	const ka = Object.keys(a), kb = Object.keys(b);
	if (ka.length !== kb.length) return false;
	return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k)
		&& isDeepStrictEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

// ── node:net ──
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
export function isIP(input: string): 0 | 4 | 6 {
	if (IPV4.test(input)) return 4;
	if (input.includes(":")) {
		try { new URL(`http://[${input}]/`); return 6; } catch { return 0; }
	}
	return 0;
}
/** node:net BlockList over IPv4 and IPv6 (addresses as BigInt). */
type Family = "ipv4" | "ipv6";
export class BlockList {
	#rules: Array<(value: bigint, family: Family) => boolean> = [];
	addAddress(address: string, family?: Family): void {
		const target = parseIp(address, family);
		if (target) this.#rules.push((v, f) => f === target.family && v === target.value);
	}
	addRange(start: string, end: string, family?: Family): void {
		const lo = parseIp(start, family), hi = parseIp(end, family);
		if (lo && hi && lo.family === hi.family) this.#rules.push((v, f) => f === lo.family && v >= lo.value && v <= hi.value);
	}
	addSubnet(net: string, prefix: number, family?: Family): void {
		const base = parseIp(net, family);
		if (!base) return;
		const bits = base.family === "ipv4" ? 32n : 128n;
		const host = bits - BigInt(prefix);
		const mask = ((1n << bits) - 1n) ^ ((1n << host) - 1n);
		this.#rules.push((v, f) => f === base.family && (v & mask) === (base.value & mask));
	}
	check(address: string, family?: Family): boolean {
		const ip = parseIp(address, family);
		return !!ip && this.#rules.some((rule) => rule(ip.value, ip.family));
	}
}

function parseIp(input: string, family?: Family): { family: Family; value: bigint } | null {
	const ip = input.replace(/^\[|\]$/g, "");
	if ((!family || family === "ipv4") && IPV4.test(ip)) {
		return { family: "ipv4", value: ip.split(".").reduce((acc, part) => (acc << 8n) + BigInt(Number(part)), 0n) };
	}
	if ((!family || family === "ipv6") && isIP(ip) === 6) {
		const value = ipv6ToBigInt(ip);
		return value === null ? null : { family: "ipv6", value };
	}
	return null;
}

function ipv6ToBigInt(ip: string): bigint | null {
	// The URL parser canonicalizes: "::ffff:1.2.3.4" → "::ffff:102:304", zones dropped.
	let canonical: string;
	try { canonical = new URL(`http://[${ip.split("%")[0]}]/`).hostname.slice(1, -1); } catch { return null; }
	const [head, tail] = canonical.includes("::") ? canonical.split("::") as [string, string] : [canonical, null];
	const left = head ? head.split(":") : [];
	const right = tail ? tail.split(":") : [];
	const groups = tail === null ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
	if (groups.length !== 8) return null;
	return groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g || "0", 16)), 0n);
}

// node:module lives in module.ts (in-process plugin backend loading).

// ── node:child_process ──
export const spawn = unavailable("Launching programs");
export const execFile = unavailable("Launching programs");
export const exec = unavailable("Launching programs");
export const fork = unavailable("Launching programs");

// node:worker_threads lives in worker_threads.ts (in-process image workers).

// ── node:http / node:readline ──
export const createServer = unavailable("Running an HTTP server");
export const createInterface = unavailable("Reading from a terminal");
