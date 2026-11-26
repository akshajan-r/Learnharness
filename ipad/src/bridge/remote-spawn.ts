/**
 * child_process.spawn on iPad: the program runs on the laptop bridge.
 *
 * Coding Questions' test runner (plugins/coding-questions/src/runner.ts)
 * writes the learner's answer into a temporary folder, spawns the teacher's
 * program there, writes the code to stdin and reads stdout/stderr/exit. This
 * object behaves like a Node ChildProcess for that use:
 *   - the request starts once stdin is ended (the runner ends it right after
 *     spawning), carrying the program, args, stdin and the working folder's
 *     files from the in-memory file system;
 *   - 'spawn', stdout/stderr 'data' (Buffers), 'exit' and 'close' replay what
 *     the laptop reports; a refusal or unreachable bridge is an 'error'
 *     followed by 'close' with pid undefined, like a failed local launch;
 *   - kill() cancels the request, and the bridge kills the process tree.
 * The bridge only runs allowlisted programs (LH_BRIDGE_PROGRAMS).
 */
import { EventEmitter } from "events";
import { Buffer as PolyfillBuffer } from "../shims/node/buffer.ts";

// The polyfill is API-compatible with Node's Buffer; type it as Node's.
const Buffer = PolyfillBuffer as unknown as BufferConstructor;
import { vol } from "../shims/node/fs.ts";
import { bridgeFetch, ndjsonLines } from "../runtime/bridge.ts";

type SpawnOptions = { cwd?: string };

class OutputStream extends EventEmitter {
	destroyed = false;
	destroy(): this { this.destroyed = true; return this; }
	setEncoding(): this { return this; }
}

class InputStream extends EventEmitter {
	readonly chunks: Buffer[] = [];
	ended = false;
	destroyed = false;
	constructor(private readonly onEnd: () => void) { super(); }
	write(chunk: string | Uint8Array, encoding?: string | (() => void)): boolean {
		if (!this.ended && chunk != null) this.chunks.push(typeof chunk === "string" ? Buffer.from(chunk, (typeof encoding === "string" ? encoding : "utf8") as BufferEncoding) : Buffer.from(chunk));
		return true;
	}
	end(chunk?: string | Uint8Array | (() => void), encoding?: string | (() => void)): this {
		if (typeof chunk === "function") chunk = undefined;
		if (chunk != null) this.write(chunk, encoding);
		if (!this.ended) { this.ended = true; this.onEnd(); }
		return this;
	}
	destroy(): this { this.destroyed = true; if (!this.ended) { this.ended = true; this.onEnd(); } return this; }
}

function snapshot(dir: string | undefined): Record<string, string> {
	const files: Record<string, string> = {};
	if (!dir) return files;
	const walk = (rel: string) => {
		let names: string[];
		try { names = vol.readdirSync(rel ? `${dir}/${rel}` : dir) as string[]; } catch { return; }
		for (const name of names) {
			const child = rel ? `${rel}/${name}` : name;
			const full = `${dir}/${child}`;
			if (vol.statSync(full).isDirectory()) walk(child);
			else files[child] = Buffer.from(vol.readFileSync(full) as Uint8Array).toString("base64");
		}
	};
	walk("");
	return files;
}

export class RemoteChildProcess extends EventEmitter {
	pid: number | undefined = undefined;
	exitCode: number | null = null;
	signalCode: string | null = null;
	killed = false;
	readonly stdout = new OutputStream();
	readonly stderr = new OutputStream();
	readonly stdin: InputStream;
	readonly stdio: [InputStream, OutputStream, OutputStream];
	#abort = new AbortController();
	#started = false;
	#closed = false;

	constructor(private readonly program: string, private readonly args: string[], private readonly options: SpawnOptions) {
		super();
		this.stdin = new InputStream(() => this.#start());
		this.stdio = [this.stdin, this.stdout, this.stderr];
		// If the caller never ends stdin, start anyway.
		setTimeout(() => this.#start(), 50);
	}

	kill(signal: string = "SIGTERM"): boolean {
		if (this.#closed) return false;
		this.killed = true;
		this.signalCode = signal;
		this.#abort.abort();
		return true;
	}

	ref(): this { return this; }
	unref(): this { return this; }

	#finish(code: number | null, signal: string | null): void {
		if (this.#closed) return;
		this.#closed = true;
		if (this.pid !== undefined && this.exitCode === null) {
			this.exitCode = code;
			this.emit("exit", code, signal);
		}
		this.emit("close", code, signal);
	}

	#fail(message: string, code?: string): void {
		if (this.#closed) return;
		this.emit("error", Object.assign(new Error(message), code ? { code } : {}));
		this.#finish(null, null);
	}

	#start(): void {
		if (this.#started) return;
		this.#started = true;
		void (async () => {
			try {
				const res = await bridgeFetch("/v1/run", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						program: this.program,
						args: this.args,
						stdin: Buffer.concat(this.stdin.chunks).toString("base64"),
						files: snapshot(this.options.cwd),
					}),
					signal: this.#abort.signal,
				});
				if (!res.ok) {
					const body = await res.json().catch(() => null) as { error?: string } | null;
					this.#fail(body?.error ?? `The laptop bridge answered HTTP ${res.status}.`, "EACCES");
					return;
				}
				for await (const line of ndjsonLines(res)) {
					const event = line as { type: string; pid?: number; data?: string; code?: number | null; signal?: string | null; message?: string };
					if (event.type === "spawn") { this.pid = event.pid ?? 1; this.emit("spawn"); }
					else if (event.type === "stdout" && !this.stdout.destroyed) this.stdout.emit("data", Buffer.from(event.data ?? "", "base64"));
					else if (event.type === "stderr" && !this.stderr.destroyed) this.stderr.emit("data", Buffer.from(event.data ?? "", "base64"));
					else if (event.type === "error") this.emit("error", Object.assign(new Error(event.message ?? "Launch failed"), { code: event.code }));
					else if (event.type === "exit") { this.exitCode = event.code ?? null; this.signalCode = event.signal ?? null; this.emit("exit", event.code ?? null, event.signal ?? null); }
					else if (event.type === "close") { this.#finish(event.code ?? null, event.signal ?? null); return; }
				}
				this.#finish(this.exitCode, this.signalCode ?? (this.killed ? "SIGKILL" : null));
			} catch (error) {
				if (this.killed) { this.#finish(null, this.signalCode ?? "SIGKILL"); return; }
				this.#fail((error as Error).message, "ECONNREFUSED");
			}
		})();
	}
}

export function spawn(command: string, args?: readonly string[] | SpawnOptions, options?: SpawnOptions): RemoteChildProcess {
	const argv = Array.isArray(args) ? [...args] : [];
	const opts = (Array.isArray(args) ? options : (args as SpawnOptions | undefined)) ?? {};
	return new RemoteChildProcess(command, argv, opts);
}
