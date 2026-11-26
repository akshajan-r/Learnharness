/** node:crypto for the iPad runtime: only what LearnHarness uses (SHA-256
 *  hashes/HMACs, random bytes and UUIDs, constant-time comparison). */
import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { Buffer as PolyfillBuffer } from "./buffer.ts";

// The polyfill is API-compatible with Node's Buffer; type it as Node's.
const Buffer = PolyfillBuffer as unknown as BufferConstructor;

type Data = string | Uint8Array;
const bytes = (data: Data, encoding?: string): Uint8Array =>
	typeof data === "string" ? Buffer.from(data, (encoding ?? "utf8") as BufferEncoding) : data;

function assertSha256(algorithm: string): void {
	if (algorithm.toLowerCase() !== "sha256") throw new Error(`crypto: ${algorithm} is not available on iPad`);
}

function digestOf(out: Uint8Array, encoding?: string): Buffer | string {
	const buf = Buffer.from(out);
	return encoding ? buf.toString(encoding as BufferEncoding) : buf;
}

export function createHash(algorithm: string) {
	assertSha256(algorithm);
	const h = sha256.create();
	const api = {
		update(data: Data, encoding?: string) { h.update(bytes(data, encoding)); return api; },
		digest(encoding?: string) { return digestOf(h.digest(), encoding); },
	};
	return api;
}

export function createHmac(algorithm: string, key: Data) {
	assertSha256(algorithm);
	const h = hmac.create(sha256, bytes(key));
	const api = {
		update(data: Data, encoding?: string) { h.update(bytes(data, encoding)); return api; },
		digest(encoding?: string) { return digestOf(h.digest(), encoding); },
	};
	return api;
}

export function randomBytes(size: number): Buffer {
	const out = new Uint8Array(size);
	globalThis.crypto.getRandomValues(out);
	return Buffer.from(out);
}

export function randomUUID(): string {
	return globalThis.crypto.randomUUID();
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) throw new RangeError("Input buffers must have the same byte length");
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
	return diff === 0;
}

export const webcrypto = globalThis.crypto;
export const subtle = globalThis.crypto.subtle;
export function getRandomValues<T extends ArrayBufferView>(array: T): T {
	return globalThis.crypto.getRandomValues(array as never) as T;
}

export default { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual, webcrypto, subtle, getRandomValues };
