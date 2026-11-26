/**
 * The iPad's side of the laptop bridge (ipad/bridge/server.ts).
 *
 * Pairing: the bridge prints a QR code / link
 *   learnharness://bridge?url=https://<laptop>.<tailnet>.ts.net&code=<pairing code>
 * Opening it launches the app, which saves the address and code to
 * /private/bridge.json (Library: backed up, not shown in Files) and checks
 * the connection.
 *
 * Requests go from the web view straight to the bridge's Tailscale HTTPS
 * address (the bridge allows the app's origin), so replies can stream.
 */
import { App } from "@capacitor/app";
import { vol } from "../shims/node/fs.ts";
import { PRIVATE_ROOT } from "./node-globals.ts";

const CONFIG_FILE = `${PRIVATE_ROOT}/bridge.json`;

export type BridgeConfig = { url: string; code: string };
export type BridgeStatus = {
	bridge: number;
	host: string;
	claudeCode: { state: string; version: string | null; minimumVersion: string };
	programs: string[];
};

export class BridgeUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BridgeUnavailableError";
	}
}

export function bridgeConfig(): BridgeConfig | null {
	try {
		const value = JSON.parse(vol.readFileSync(CONFIG_FILE, "utf8") as string) as Partial<BridgeConfig>;
		return typeof value.url === "string" && typeof value.code === "string" ? { url: value.url, code: value.code } : null;
	} catch {
		return null;
	}
}

function saveConfig(config: BridgeConfig): void {
	vol.mkdirSync(PRIVATE_ROOT, { recursive: true });
	vol.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, "\t"));
}

const NOT_PAIRED = "The laptop bridge isn't paired. On the laptop, run `npm run bridge` in the learnharness folder and scan its QR code with the iPad camera.";

/** fetch() to the paired bridge, with the pairing code. */
export async function bridgeFetch(path: string, init: RequestInit = {}): Promise<Response> {
	const config = bridgeConfig();
	if (!config) throw new BridgeUnavailableError(NOT_PAIRED);
	const headers = new Headers(init.headers);
	headers.set("Authorization", `Bearer ${config.code}`);
	let res: Response;
	try {
		res = await fetch(`${config.url}${path}`, { ...init, headers });
	} catch (error) {
		if ((error as Error)?.name === "AbortError") throw error;
		throw new BridgeUnavailableError(`Can't reach the laptop bridge at ${config.url}. Check that the laptop is on, Tailscale is connected on both devices, and \`npm run bridge\` is running.`);
	}
	if (res.status === 401) throw new BridgeUnavailableError("The laptop bridge rejected the pairing code. Scan the bridge's QR code again.");
	return res;
}

export async function bridgeStatus(): Promise<BridgeStatus> {
	const res = await bridgeFetch("/v1/status", { signal: AbortSignal.timeout(8_000) });
	if (!res.ok) throw new BridgeUnavailableError(`The laptop bridge answered HTTP ${res.status}.`);
	return (await res.json()) as BridgeStatus;
}

/** Read an NDJSON response line by line. */
export async function* ndjsonLines(res: Response): AsyncGenerator<unknown> {
	if (!res.body) return;
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let newline: number;
		while ((newline = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			if (line) yield JSON.parse(line);
		}
	}
	if (buffer.trim()) yield JSON.parse(buffer);
}

async function pairFrom(link: string): Promise<void> {
	let url: URL;
	try { url = new URL(link); } catch { return; }
	if (url.protocol !== "learnharness:" || url.hostname !== "bridge") return;
	const address = url.searchParams.get("url") ?? "";
	const code = url.searchParams.get("code") ?? "";
	if (!/^https:\/\/[^/]+$/.test(address) || code.length < 24) {
		alert("That pairing link is incomplete. Scan the QR code from `npm run bridge` again.");
		return;
	}
	saveConfig({ url: address, code });
	try {
		const status = await bridgeStatus();
		const claude = status.claudeCode.state === "meets-minimum" ? `Claude Code ${status.claudeCode.version} is ready` : `Claude Code: ${status.claudeCode.state}`;
		alert(`Paired with the laptop bridge on ${status.host}.\n\n${claude}. Code running: ${status.programs.join(", ")}.\n\nTo use Claude Code, turn it on in Settings → Providers → External CLI.`);
	} catch (error) {
		alert(`Saved the laptop bridge, but couldn't reach it yet:\n\n${(error as Error).message}`);
	}
}

export async function installBridgePairing(): Promise<void> {
	App.addListener("appUrlOpen", ({ url }) => { void pairFrom(url); }).catch(() => {});
	try {
		const launch = await App.getLaunchUrl();
		if (launch?.url) void pairFrom(launch.url);
	} catch { /* not native */ }
}
