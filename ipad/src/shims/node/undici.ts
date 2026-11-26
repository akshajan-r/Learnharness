/**
 * undici for the iPad runtime — used only by src/agent/tools/safe-fetch.ts
 * (research web_fetch / web_fetch_pdf: model-chosen URLs).
 *
 * Desktop checks the address each connection actually reaches, after DNS,
 * so a fetched page can't steer the researcher into the LAN, loopback or
 * cloud metadata. A web view can't see connections, so here every hop is
 * checked before it is requested:
 *   - IP literals and local host names are judged directly;
 *   - other names are resolved over DNS-over-HTTPS and refused if any
 *     address is non-public (or if the lookup fails: fail closed);
 *   - redirects are followed one at a time, each checked the same way.
 * The remaining gap versus desktop: the system resolver could answer
 * differently from the DNS-over-HTTPS lookup (DNS rebinding).
 *
 * Requests go through native iOS networking (no CORS); in a desktop
 * browser they fall back to the page's fetch.
 */
import { isIP } from "./misc.ts";
import { nativeFetch, nativeHttpAvailable, resolveHost } from "../../runtime/native-http.ts";

type Connector = (options: { hostname: string }, callback: (error: Error | null, socket: unknown) => void) => void;

export class Agent {
	constructor(public options: { connect?: Connector } = {}) {}
	close(): Promise<void> { return Promise.resolve(); }
	destroy(): Promise<void> { return Promise.resolve(); }
}

export function buildConnector(): Connector {
	return (_options, callback) => callback(null, { remoteAddress: "" });
}

const LOCAL_NAMES = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa|.*\.lan)$/i;
const MAX_REDIRECTS = 10;

const refusal = (host: string) => Object.assign(new TypeError("fetch failed"), {
	cause: new Error(`refusing to connect to a private or local address (${host})`),
});

async function checkHost(host: string): Promise<void> {
	const { isPublicAddress } = await import("@/src/agent/tools/safe-fetch.ts");
	if (isIP(host)) {
		if (!isPublicAddress(host)) throw refusal(host);
		return;
	}
	if (LOCAL_NAMES.test(host) || !host.includes(".")) throw refusal(host);
	let addresses: string[];
	try { addresses = await resolveHost(host); }
	catch (error) { throw Object.assign(new TypeError("fetch failed"), { cause: new Error(`could not check ${host} before connecting: ${(error as Error).message}`) }); }
	if (addresses.some((a) => !isPublicAddress(a))) throw refusal(host);
}

export async function fetch(input: string | URL | Request, init: RequestInit & { dispatcher?: Agent } = {}): Promise<Response> {
	const { dispatcher, ...rest } = init;
	const send = nativeHttpAvailable() ? nativeFetch : globalThis.fetch.bind(globalThis);
	if (!dispatcher?.options.connect) return send(input instanceof Request ? input : String(input), rest);

	let url = new URL(input instanceof Request ? input.url : String(input));
	let method = rest.method ?? "GET";
	let body = rest.body;
	for (let hop = 0; ; hop++) {
		await checkHost(url.hostname.replace(/^\[|\]$/g, ""));
		const response = await send(url.href, { ...rest, method, body, redirect: "manual" });
		const location = response.headers.get("location");
		if (response.status < 300 || response.status >= 400 || !location) {
			if (!response.url) Object.defineProperty(response, "url", { value: url.href });
			return response;
		}
		if (hop >= MAX_REDIRECTS) throw Object.assign(new TypeError("fetch failed"), { cause: new Error("too many redirects") });
		url = new URL(location, url);
		// 303 (and 301/302 for POST, as browsers do) continue as GET.
		if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
			method = "GET";
			body = undefined;
		}
	}
}

export default { Agent, buildConnector, fetch };
