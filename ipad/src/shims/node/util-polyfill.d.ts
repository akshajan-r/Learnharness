// The `util` npm polyfill ships no types; it mirrors node:util's surface.
declare module "util/" {
	const util: typeof import("node:util");
	export default util;
}
