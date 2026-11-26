// The `util` npm polyfill ships no types; it mirrors node:util's surface.
declare module "util/" {
	const util: typeof import("node:util");
	export default util;
}

// path-browserify ships no types; it is node:path's POSIX implementation.
declare module "path-browserify" {
	const path: typeof import("node:path").posix;
	export default path;
}

declare module "qrcode-terminal" {
	const qrcode: { generate(text: string, options?: { small?: boolean }, callback?: (qr: string) => void): void };
	export default qrcode;
}
