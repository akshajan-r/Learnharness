// "util/" (trailing slash) skips the alias that points "util" back at this file.
import util from "util/";
import { isDeepStrictEqual } from "./misc.ts";
export { isDeepStrictEqual };
export const { inherits, promisify, format, inspect, deprecate, debuglog, types } = util as typeof import("node:util");
export const TextDecoder = globalThis.TextDecoder;
export const TextEncoder = globalThis.TextEncoder;
export default { ...util, isDeepStrictEqual, TextDecoder: globalThis.TextDecoder, TextEncoder: globalThis.TextEncoder };
