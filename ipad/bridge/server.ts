/**
 * LearnHarness laptop bridge.
 *
 * Runs on the laptop (`npm run bridge` in the repo root) so the iPad app
 * can use the two things iPadOS can't do itself:
 *
 *   1. The Claude Code CLI. The iPad sends each model turn (model, context,
 *      options); this process runs LearnHarness's own Claude Code engine
 *      (src/agent/claude-code/stream.ts) and streams its events back. Tool
 *      calls and their results travel the same way, so held CLI processes,
 *      reuse and cancellation behave as on desktop.
 *   2. Running programs for Coding Questions: the iPad sends the program,
 *      arguments, stdin and working files; they run in a fresh temporary
 *      folder here and stdout/stderr/exit stream back. Only allowlisted
 *      programs run (LH_BRIDGE_PROGRAMS, default python, python3, py, node).
 *
 * Exposure: the server listens on 127.0.0.1 only. `tailscale serve` (set up
 * on start) publishes it as https://<laptop>.<tailnet>.ts.net, reachable
 * only from your own Tailscale devices. Every request also needs the pairing
 * code, a random secret kept in ~/.learnharness-bridge/token.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { constants as zlibConstants, createGzip } from "node:zlib";
import type { Api, Model, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import { streamClaudeCode } from "../../src/agent/claude-code/stream.ts";
import { inspectClaudeInstallation } from "../../src/agent/claude-code/installation.ts";

const PORT = Number(process.env.LH_BRIDGE_PORT ?? 8790);
const PROGRAMS = new Set((process.env.LH_BRIDGE_PROGRAMS ?? "python,python3,py,node").split(",").map((p) => p.trim().toLowerCase()).filter(Boolean));
const RUN_TIMEOUT_MS = 60_000;
const OUTPUT_LIMIT = 1024 * 1024;
const BODY_LIMIT = 64 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set(["capacitor://localhost", "http://localhost:4173", "http://localhost:5173"]);
const BRIDGE_VERSION = 1;

// ── Pairing code ──

function loadToken(): string {
	const dir = path.join(os.homedir(), ".learnharness-bridge");
	const file = path.join(dir, "token");
	try {
		const existing = fs.readFileSync(file, "utf8").trim();
		if (existing.length >= 24) return existing;
	} catch { /* first run */ }
	fs.mkdirSync(dir, { recursive: true });
	const token = randomBytes(24).toString("base64url");
	fs.writeFileSync(file, token, { mode: 0o600 });
	return token;
}
const TOKEN = loadToken();

function authorized(req: http.IncomingMessage): boolean {
	const supplied = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
	const a = Buffer.from(supplied), b = Buffer.from(TOKEN);
	return a.length === b.length && timingSafeEqual(a, b);
}

// ── HTTP helpers ──

function cors(req: http.IncomingMessage, res: http.ServerResponse): void {
	const origin = req.headers.origin;
	if (origin && ALLOWED_ORIGINS.has(origin)) {
		res.setHeader("Access-Control-Allow-Origin", origin);
		res.setHeader("Vary", "Origin");
		res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader("Access-Control-Max-Age", "600");
	}
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
	res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > BODY_LIMIT) throw new Error("Request too large");
		chunks.push(chunk as Buffer);
	}
	const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
	return value as Record<string, unknown>;
}

/** A gzip'd NDJSON response flushed per line. Stream events repeat the
 *  growing partial message, which compresses to almost nothing. */
function ndjson(req: http.IncomingMessage, res: http.ServerResponse) {
	const gzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
	res.writeHead(200, {
		"Content-Type": "application/x-ndjson",
		"Cache-Control": "no-store",
		"X-Accel-Buffering": "no",
		...(gzip ? { "Content-Encoding": "gzip" } : {}),
	});
	const out = gzip ? createGzip({ flush: zlibConstants.Z_SYNC_FLUSH }) : null;
	out?.pipe(res);
	return {
		write(value: unknown) { (out ?? res).write(`${JSON.stringify(value)}\n`); },
		end() { if (out) out.end(); else res.end(); },
	};
}

/** Aborted when the iPad cancels or the connection drops. */
function clientGone(req: http.IncomingMessage, res: http.ServerResponse): AbortSignal {
	const controller = new AbortController();
	res.on("close", () => { if (!res.writableFinished) controller.abort(); });
	req.on("aborted", () => controller.abort());
	return controller.signal;
}

// ── Claude Code ──

async function claudeCodeStream(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
	const body = await readJson(req);
	const model = body.model as Model<Api>;
	// The transcript brand is type-only; the iPad sent an already-normalized context.
	const context = body.context as unknown as TranscriptContext;
	const options = (body.options ?? {}) as SimpleStreamOptions;
	const signal = clientGone(req, res);
	const out = ndjson(req, res);
	const stream = streamClaudeCode(model, context, { ...options, signal });
	try {
		for await (const event of stream) {
			out.write(event);
			if (event.type === "done" || event.type === "error") break;
		}
	} finally {
		out.end();
	}
}

// ── Running programs ──

function programAllowed(program: string): boolean {
	if (!program || path.isAbsolute(program) || /[\\/]/.test(program)) return false;
	return PROGRAMS.has(program.toLowerCase().replace(/\.exe$/, ""));
}

function safeRelative(rel: string): string | null {
	const normalized = path.normalize(rel).replace(/^([\\/])+/, "");
	if (!normalized || normalized.startsWith("..") || path.isAbsolute(normalized)) return null;
	return normalized;
}

function killTree(child: ChildProcess): void {
	if (child.pid === undefined || child.exitCode !== null) return;
	if (process.platform === "win32") {
		const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
		killer.on("error", () => child.kill("SIGKILL"));
	} else {
		try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
	}
}

async function runProgram(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
	const body = await readJson(req);
	const program = String(body.program ?? "");
	const args = Array.isArray(body.args) ? body.args.map(String) : [];
	if (!programAllowed(program)) {
		sendJson(res, 403, { error: `"${program}" isn't allowed on the laptop bridge. Allowed: ${[...PROGRAMS].join(", ")} (set LH_BRIDGE_PROGRAMS to change).` });
		return;
	}
	const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lh-bridge-run-"));
	try {
		for (const [rel, data] of Object.entries((body.files ?? {}) as Record<string, string>)) {
			const safe = safeRelative(rel);
			if (!safe) continue;
			fs.mkdirSync(path.dirname(path.join(workspace, safe)), { recursive: true });
			fs.writeFileSync(path.join(workspace, safe), Buffer.from(data, "base64"));
		}
		const signal = clientGone(req, res);
		const out = ndjson(req, res);
		await new Promise<void>((resolve) => {
			let sent = 0;
			const child = spawn(program, args, {
				cwd: workspace,
				shell: false,
				windowsHide: true,
				detached: process.platform !== "win32",
				stdio: ["pipe", "pipe", "pipe"],
			});
			const stop = () => killTree(child);
			const timer = setTimeout(stop, RUN_TIMEOUT_MS);
			signal.addEventListener("abort", stop, { once: true });
			const forward = (type: "stdout" | "stderr") => (chunk: Buffer) => {
				if (sent >= OUTPUT_LIMIT) return;
				sent += chunk.length;
				out.write({ type, data: chunk.toString("base64") });
			};
			child.on("spawn", () => out.write({ type: "spawn", pid: child.pid }));
			child.stdout.on("data", forward("stdout"));
			child.stderr.on("data", forward("stderr"));
			child.stdin.on("error", () => {});
			child.on("error", (error) => { out.write({ type: "error", message: error.message, code: (error as NodeJS.ErrnoException).code }); });
			child.on("exit", (code, sig) => out.write({ type: "exit", code, signal: sig }));
			child.on("close", (code, sig) => {
				clearTimeout(timer);
				out.write({ type: "close", code, signal: sig });
				out.end();
				resolve();
			});
			child.stdin.end(typeof body.stdin === "string" ? Buffer.from(body.stdin, "base64") : undefined);
		});
	} finally {
		fs.rmSync(workspace, { recursive: true, force: true });
	}
}

// ── Server ──

const server = http.createServer(async (req, res) => {
	cors(req, res);
	if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
	if (!authorized(req)) { sendJson(res, 401, { error: "Wrong or missing pairing code. Pair the iPad again from the bridge's QR code." }); return; }
	const url = new URL(req.url ?? "/", "http://bridge");
	try {
		if (req.method === "GET" && url.pathname === "/v1/status") {
			sendJson(res, 200, { bridge: BRIDGE_VERSION, host: os.hostname(), claudeCode: await inspectClaudeInstallation(), programs: [...PROGRAMS] });
		} else if (req.method === "POST" && url.pathname === "/v1/claude-code/stream") {
			await claudeCodeStream(req, res);
		} else if (req.method === "POST" && url.pathname === "/v1/run") {
			await runProgram(req, res);
		} else {
			sendJson(res, 404, { error: "Not found" });
		}
	} catch (error) {
		if (!res.headersSent) sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
		else res.destroy();
	}
});

function run(file: string, args: string[]): Promise<{ ok: boolean; out: string }> {
	return new Promise((resolve) => execFile(file, args, { windowsHide: true, timeout: 20_000 }, (error, stdout, stderr) => {
		resolve({ ok: !error, out: `${stdout}${stderr}`.trim() });
	}));
}

server.listen(PORT, "127.0.0.1", async () => {
	console.log(`\nLearnHarness laptop bridge listening on 127.0.0.1:${PORT}`);
	const status = await run("tailscale", ["status", "--json"]);
	let dnsName = "";
	try { dnsName = String(JSON.parse(status.out).Self?.DNSName ?? "").replace(/\.$/, ""); } catch { /* not running */ }
	if (!dnsName) {
		console.log("\n! Tailscale isn't running or isn't signed in. Start Tailscale, then restart the bridge.");
		return;
	}
	const serve = await run("tailscale", ["serve", "--bg", "--https=443", `http://127.0.0.1:${PORT}`]);
	if (!serve.ok) {
		console.log(`\n! Couldn't publish the bridge with "tailscale serve":\n  ${serve.out.split("\n").join("\n  ")}`);
		console.log("\n  If it mentions HTTPS, turn on HTTPS Certificates at https://login.tailscale.com/admin/dns and restart the bridge.");
		return;
	}
	const url = `https://${dnsName}`;
	const link = `learnharness://bridge?url=${encodeURIComponent(url)}&code=${encodeURIComponent(TOKEN)}`;
	const claude = await inspectClaudeInstallation();
	console.log(`Published on your tailnet at ${url}`);
	console.log(`Claude Code: ${claude.state}${claude.version ? ` (${claude.version})` : ""} · Programs: ${[...PROGRAMS].join(", ")}`);
	console.log("\nPair the iPad: point its camera at this code and tap the banner (once; it's remembered):\n");
	const { default: qrcode } = await import("qrcode-terminal");
	qrcode.generate(link, { small: true });
	console.log(`\nOr open this link on the iPad:\n${link}\n\nLeave this window open while you use Claude Code or run code on the iPad. Ctrl+C stops the bridge.`);
});
