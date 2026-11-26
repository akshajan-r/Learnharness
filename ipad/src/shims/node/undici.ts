/**
 * undici for the iPad runtime — used only by src/agent/tools/safe-fetch.ts.
 *
 * KNOWN GAP: desktop checks the address each connection actually reaches
 * (after DNS). A web view cannot see resolved addresses, so here only
 * private/loopback IP literals and localhost names are refused before the
 * request. Phase 1 moves research fetches to native iOS networking, which
 * also removes the CORS limits that a web view puts on arbitrary pages.
 */
type Connector = (options: { hostname: string }, callback: (error: Error | null, socket: unknown) => void) => void;

export class Agent {
	constructor(public options: { connect?: Connector } = {}) {}
	close(): Promise<void> { return Promise.resolve(); }
	destroy(): Promise<void> { return Promise.resolve(); }
}

export function buildConnector(): Connector {
	return (_options, callback) => callback(null, { remoteAddress: "" });
}

const LOCAL_NAMES = /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i;

export async function fetch(input: string | URL | Request, init: RequestInit & { dispatcher?: Agent } = {}): Promise<Response> {
	const { dispatcher, ...rest } = init;
	const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
	const host = url.hostname.replace(/^\[|\]$/g, "");
	const connect = dispatcher?.options.connect;
	if (connect) {
		if (LOCAL_NAMES.test(host)) throw Object.assign(new TypeError("fetch failed"), { cause: new Error(`refusing to connect to a private or local address (${host})`) });
		// Let the caller's address check judge IP literals; names pass (no DNS view).
		await new Promise<void>((resolve, reject) => {
			connect({ hostname: host }, () => resolve());
			void reject;
		});
		const { isIP } = await import("./misc.ts");
		if (isIP(host)) {
			const { isPublicAddress } = await import("@/src/agent/tools/safe-fetch.ts");
			if (!isPublicAddress(host)) throw Object.assign(new TypeError("fetch failed"), { cause: new Error(`refusing to connect to a private or local address (${host})`) });
		}
	}
	return globalThis.fetch(url, rest);
}

export default { Agent, buildConnector, fetch };
