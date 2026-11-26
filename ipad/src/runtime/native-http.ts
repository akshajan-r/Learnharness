/**
 * Native HTTP for requests a web view can't make.
 *
 * WebKit applies CORS to every fetch from the app's page, so reading an
 * arbitrary web page (research web_fetch / web_fetch_pdf) or calling an
 * API that doesn't send CORS headers (Brave search, …) fails in the web
 * view. On iPad these go through iOS's own networking (CapacitorHttp,
 * URLSession), which has no CORS, and come back as an ordinary Response.
 *
 * Model streaming stays on the web view's fetch: CapacitorHttp returns a
 * whole response at once and can't stream.
 */
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Buffer } from "../shims/node/buffer.ts";

/** Search APIs and the reader fallback the research tools call by name. */
const NATIVE_HOSTS = new Set([
	"api.tavily.com",
	"api.search.brave.com",
	"api.exa.ai",
	"api.firecrawl.dev",
	"ollama.com",
	"r.jina.ai",
]);

export const nativeHttpAvailable = (): boolean => Capacitor.isNativePlatform();

/** Requests the global fetch should hand to native networking. */
export function prefersNative(url: URL): boolean {
	return nativeHttpAvailable() && NATIVE_HOSTS.has(url.hostname);
}

function headersOf(init: RequestInit | undefined, request?: Request): Record<string, string> {
	const out: Record<string, string> = {};
	new Headers(request?.headers).forEach((v, k) => { out[k] = v; });
	new Headers(init?.headers).forEach((v, k) => { out[k] = v; });
	return out;
}

async function bodyOf(init: RequestInit | undefined, request?: Request): Promise<string | undefined> {
	const body = init?.body ?? (request && !["GET", "HEAD"].includes(request.method) ? await request.text() : undefined);
	if (body == null) return undefined;
	if (typeof body === "string") return body;
	if (body instanceof URLSearchParams) return body.toString();
	if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return new TextDecoder().decode(body as ArrayBuffer);
	if (body instanceof Blob) return body.text();
	throw new Error("native fetch: unsupported request body");
}

/**
 * fetch() over native networking. `redirect: "manual"` returns 3xx
 * responses (with their Location header) instead of following them, so a
 * caller can check each hop.
 */
export async function nativeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
	const request = input instanceof Request ? input : undefined;
	const url = request ? request.url : String(input);
	const signal = init.signal ?? request?.signal;
	signal?.throwIfAborted();
	const call = CapacitorHttp.request({
		url,
		method: (init.method ?? request?.method ?? "GET").toUpperCase(),
		headers: headersOf(init, request),
		data: await bodyOf(init, request),
		responseType: "arraybuffer",
		disableRedirects: (init.redirect ?? request?.redirect) === "manual",
		connectTimeout: 30_000,
		readTimeout: 30_000,
	});
	const aborted = signal
		? new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")), { once: true }))
		: null;
	let res;
	try {
		res = await (aborted ? Promise.race([call, aborted]) : call);
	} catch (error) {
		if (signal?.aborted) throw error;
		throw Object.assign(new TypeError("fetch failed"), { cause: error });
	}
	// arraybuffer responses arrive base64-encoded over the bridge.
	const bytes = typeof res.data === "string" ? new Uint8Array(Buffer.from(res.data, "base64")) : new Uint8Array(0);
	const headers = new Headers();
	for (const [k, v] of Object.entries(res.headers ?? {})) headers.set(k, String(v));
	const nullBody = res.status === 204 || res.status === 304 || (res.status >= 100 && res.status < 200);
	const response = new Response(nullBody ? null : bytes, { status: res.status, headers });
	Object.defineProperty(response, "url", { value: res.url || url });
	return response;
}

/**
 * The addresses a host name resolves to, via DNS-over-HTTPS (the web view
 * has no DNS API). Used to refuse names that point at private networks.
 */
export async function resolveHost(hostname: string): Promise<string[]> {
	const addresses: string[] = [];
	for (const type of ["A", "AAAA"]) {
		const res = await globalThis.fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, {
			headers: { Accept: "application/dns-json" },
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) throw new Error(`DNS lookup for ${hostname} failed (HTTP ${res.status})`);
		const answer = (await res.json()) as { Answer?: Array<{ type: number; data: string }> };
		for (const record of answer.Answer ?? []) {
			if (record.type === 1 || record.type === 28) addresses.push(record.data);
		}
	}
	return addresses;
}
