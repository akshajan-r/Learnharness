/**
 * node:buffer for the iPad runtime: the `buffer` npm polyfill plus the
 * "base64url" encoding Node supports and the polyfill lacks (used for
 * ETags, nonces and OAuth values).
 */
// "buffer/" (trailing slash) skips the alias that points "buffer" back here.
import * as polyfill from "buffer/";

const { Buffer } = polyfill;
type Encoding = Parameters<typeof Buffer.from>[1];

const toUrl = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromUrl = (s: string) => s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);

const patched = Buffer as unknown as { __lhBase64url?: boolean };
if (!patched.__lhBase64url) {
	patched.__lhBase64url = true;
	const toString = Buffer.prototype.toString;
	Buffer.prototype.toString = function (this: InstanceType<typeof Buffer>, encoding?: string, start?: number, end?: number) {
		if (encoding === "base64url") return toUrl(toString.call(this, "base64", start, end));
		return toString.call(this, encoding as Encoding, start, end);
	} as typeof Buffer.prototype.toString;
	const from = Buffer.from;
	Buffer.from = function (value: unknown, encodingOrOffset?: unknown, length?: unknown) {
		if (typeof value === "string" && encodingOrOffset === "base64url") return from.call(Buffer, fromUrl(value), "base64");
		return (from as (...a: unknown[]) => InstanceType<typeof Buffer>).call(Buffer, value, encodingOrOffset, length);
	} as typeof Buffer.from;
	const isEncoding = Buffer.isEncoding;
	Buffer.isEncoding = (encoding: string) => encoding === "base64url" || isEncoding(encoding);
	const byteLength = Buffer.byteLength;
	Buffer.byteLength = ((value: unknown, encoding?: unknown) =>
		typeof value === "string" && encoding === "base64url"
			? byteLength(fromUrl(value), "base64")
			: (byteLength as (...a: unknown[]) => number)(value, encoding)) as typeof Buffer.byteLength;
}

export { Buffer };
const extras = polyfill as unknown as { SlowBuffer: unknown; INSPECT_MAX_BYTES: number; kMaxLength: number };
export const { SlowBuffer, INSPECT_MAX_BYTES, kMaxLength } = extras;
export const Blob = globalThis.Blob;
export const atob = globalThis.atob;
export const btoa = globalThis.btoa;
export default { ...polyfill, Buffer, Blob, atob, btoa };
