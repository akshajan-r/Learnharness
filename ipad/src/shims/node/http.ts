/** node:http / node:https for the iPad runtime. Outbound requests go through
 *  fetch; nothing here may open a server or a raw socket. Dependencies that
 *  only reference these classes (proxy agents, the MCP SDK's server adapter)
 *  load fine and fail if actually used. */
import { createServer, IpadUnavailableError } from "./misc.ts";

export { createServer };

export class Agent {
	constructor(public options: unknown = {}) {}
	destroy(): void {}
}
export const globalAgent = new Agent();

export class IncomingMessage {
	constructor() { throw new IpadUnavailableError("node:http IncomingMessage"); }
}
export class ServerResponse {
	constructor() { throw new IpadUnavailableError("node:http ServerResponse"); }
}

export const STATUS_CODES: Record<number, string> = {
	200: "OK", 201: "Created", 204: "No Content", 301: "Moved Permanently", 302: "Found",
	304: "Not Modified", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
	404: "Not Found", 409: "Conflict", 413: "Payload Too Large", 429: "Too Many Requests",
	500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout",
};

const noRawRequests = () => { throw new IpadUnavailableError("node:http requests (use fetch)"); };
export const request = noRawRequests;
export const get = noRawRequests;

export default { createServer, Agent, globalAgent, IncomingMessage, ServerResponse, STATUS_CODES, request, get };
