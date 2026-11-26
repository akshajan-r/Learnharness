/**
 * The in-app API. The UI keeps calling `fetch("/api/…")` and opening
 * `EventSource("/api/events")` exactly as on desktop; on iPad those calls
 * never touch the network — they are dispatched straight to the unchanged
 * Next route handlers under app/api, which all take a standard Request and
 * return a standard Response.
 *
 * The desktop's API origin guard (proxy.ts) protects a loopback HTTP port
 * from other local programs and web pages. Nothing listens on a port here,
 * so there is nothing for it to guard.
 */

import { nativeFetch as nativeHttpFetch, prefersNative } from "./native-http.ts";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string | string[]>> }) => Response | Promise<Response>;
type RouteModule = Partial<Record<string, Handler>>;

const modules = import.meta.glob("../../../app/api/**/route.ts") as Record<string, () => Promise<RouteModule>>;

type Route = { pattern: RegExp; keys: Array<{ name: string; catchAll: boolean }>; load: () => Promise<RouteModule>; specificity: number[] };

function compile(file: string, load: () => Promise<RouteModule>): Route {
	const segments = file.replace(/^.*\/app\/api/, "").replace(/\/route\.ts$/, "").split("/").filter(Boolean);
	const keys: Route["keys"] = [];
	// Static segments outrank [param], which outranks [...catchAll] (Next's order).
	const specificity: number[] = [];
	const parts = segments.map((seg) => {
		const catchAll = seg.match(/^\[\.\.\.(.+)\]$/);
		if (catchAll) { keys.push({ name: catchAll[1]!, catchAll: true }); specificity.push(0); return "/(.+)"; }
		const param = seg.match(/^\[(.+)\]$/);
		if (param) { keys.push({ name: param[1]!, catchAll: false }); specificity.push(1); return "/([^/]+)"; }
		specificity.push(2);
		return "/" + seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	});
	return { pattern: new RegExp(`^/api${parts.join("")}/?$`), keys, load, specificity };
}

const routes: Route[] = Object.entries(modules)
	.map(([file, load]) => compile(file, load))
	.sort((a, b) => {
		for (let i = 0; i < Math.max(a.specificity.length, b.specificity.length); i++) {
			const d = (b.specificity[i] ?? -1) - (a.specificity[i] ?? -1);
			if (d) return d;
		}
		return 0;
	});

export function isApiUrl(url: URL): boolean {
	return url.origin === location.origin && (url.pathname === "/api" || url.pathname.startsWith("/api/"));
}

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * The origin route handlers see. Only the app's own same-origin /api calls
 * reach dispatch(), so each is presented as a same-origin browser request
 * from one fixed internal origin. A fixed http origin matters on iOS, where
 * the web view's own origin is capacitor://localhost and the handlers'
 * same-origin checks (desktop-access.ts) accept only http(s).
 */
const INTERNAL_ORIGIN = "http://localhost";

function asInternal(request: Request): Request {
	const url = new URL(request.url);
	const hasBody = !["GET", "HEAD"].includes(request.method.toUpperCase());
	const internal = new Request(`${INTERNAL_ORIGIN}${url.pathname}${url.search}`, {
		method: request.method,
		headers: request.headers,
		body: hasBody ? request.body : undefined,
		signal: request.signal,
		// Required by fetch for streamed request bodies.
		...(hasBody ? { duplex: "half" } : {}),
	} as RequestInit);
	// Browsers silently drop Host/Origin/Sec-* from a Request's own headers
	// (forbidden names), but a standalone Headers object may carry them.
	const headers = new Headers(request.headers);
	headers.set("host", "localhost");
	headers.set("origin", INTERNAL_ORIGIN);
	headers.set("sec-fetch-site", "same-origin");
	Object.defineProperty(internal, "headers", { value: headers });
	return internal;
}

/** Run one API request in-process. */
export async function dispatch(incoming: Request): Promise<Response> {
	const request = asInternal(incoming);
	const url = new URL(request.url);
	for (const route of routes) {
		const match = url.pathname.match(route.pattern);
		if (!match) continue;
		const params: Record<string, string | string[]> = {};
		route.keys.forEach((key, i) => {
			const raw = match[i + 1]!;
			params[key.name] = key.catchAll ? raw.split("/").map(decodeURIComponent) : decodeURIComponent(raw);
		});
		const mod = await route.load();
		const method = request.method.toUpperCase();
		const handler = mod[method] ?? (method === "HEAD" ? mod.GET : undefined);
		if (!handler) return json(405, { error: `Method ${method} not allowed` });
		try {
			return await handler(request, { params: Promise.resolve(params) });
		} catch (error) {
			console.error(`[api] ${method} ${url.pathname} failed`, error);
			return json(500, { error: error instanceof Error ? error.message : String(error) });
		}
	}
	return json(404, { error: `No API route for ${url.pathname}` });
}

const nativeFetch = globalThis.fetch.bind(globalThis);

/** Route same-origin /api requests through dispatch(); search APIs that
 *  don't allow browser requests through native networking (native-http.ts);
 *  everything else (model providers, streaming) to the web view's fetch. */
export function installApiFetch(): void {
	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = new URL(input instanceof Request ? input.url : String(input), location.href);
		if (prefersNative(url)) return nativeHttpFetch(input instanceof Request ? input : url, init);
		if (!isApiUrl(url)) return nativeFetch(input, init);
		const request = input instanceof Request ? new Request(input, init) : new Request(url, init);
		return dispatch(request);
	};
	installEventSource();
}

/**
 * EventSource for in-process /api streams: reads the route's SSE body and
 * replays it as MessageEvents. Reconnects after the stream ends, like the
 * browser's own EventSource (the events route is long-lived).
 */
function installEventSource(): void {
	const Native = globalThis.EventSource;

	class InAppEventSource extends EventTarget {
		static readonly CONNECTING = 0;
		static readonly OPEN = 1;
		static readonly CLOSED = 2;
		readonly CONNECTING = 0;
		readonly OPEN = 1;
		readonly CLOSED = 2;
		readyState = 0;
		readonly url: string;
		readonly withCredentials = false;
		onopen: ((ev: Event) => void) | null = null;
		onmessage: ((ev: MessageEvent) => void) | null = null;
		onerror: ((ev: Event) => void) | null = null;
		#abort = new AbortController();
		#retryMs = 1000;

		constructor(url: string | URL) {
			super();
			this.url = new URL(String(url), location.href).href;
			void this.#connect();
		}

		close(): void {
			this.readyState = 2;
			this.#abort.abort();
		}

		#emit(event: Event): void {
			this.dispatchEvent(event);
			const handler = (this as unknown as Record<string, unknown>)[`on${event.type}`];
			if (typeof handler === "function") handler.call(this, event);
		}

		async #connect(): Promise<void> {
			while (this.readyState !== 2) {
				try {
					const res = await dispatch(new Request(this.url, { headers: { Accept: "text/event-stream" }, signal: this.#abort.signal }));
					if (!res.ok || !res.body) throw new Error(`event stream returned ${res.status}`);
					this.readyState = 1;
					this.#emit(new Event("open"));
					await this.#read(res.body);
				} catch (error) {
					if (this.readyState === 2) return;
					console.warn("[events] stream error", error);
				}
				if (this.readyState === 2) return;
				this.readyState = 0;
				this.#emit(new Event("error"));
				await new Promise((r) => setTimeout(r, this.#retryMs));
			}
		}

		async #read(body: ReadableStream<Uint8Array>): Promise<void> {
			const reader = body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			for (;;) {
				const { value, done } = await reader.read();
				if (done) return;
				buffer += decoder.decode(value, { stream: true });
				let cut: number;
				while ((cut = buffer.search(/\r?\n\r?\n/)) >= 0) {
					const block = buffer.slice(0, cut);
					buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, "");
					this.#dispatchBlock(block);
				}
			}
		}

		#dispatchBlock(block: string): void {
			let type = "message";
			const data: string[] = [];
			let lastEventId = "";
			for (const line of block.split(/\r?\n/)) {
				if (!line || line.startsWith(":")) continue;
				const colon = line.indexOf(":");
				const field = colon < 0 ? line : line.slice(0, colon);
				const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
				if (field === "event") type = value;
				else if (field === "data") data.push(value);
				else if (field === "id") lastEventId = value;
				else if (field === "retry" && /^\d+$/.test(value)) this.#retryMs = Number(value);
			}
			if (!data.length) return;
			this.#emit(new MessageEvent(type, { data: data.join("\n"), lastEventId, origin: location.origin }));
		}
	}

	globalThis.EventSource = function EventSourceRouter(url: string | URL, init?: EventSourceInit) {
		const target = new URL(String(url), location.href);
		return isApiUrl(target) ? new InAppEventSource(target) : new Native(url, init);
	} as unknown as typeof EventSource;
	Object.assign(globalThis.EventSource, { CONNECTING: 0, OPEN: 1, CLOSED: 2 });
}
