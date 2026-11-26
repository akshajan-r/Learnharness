/**
 * Native Node add-ons with no iPad build. Every entry point throws a clear
 * error; the visual/PDF/demo workers surface it through their existing
 * failure handling. Phase 1 replaces these with WebAssembly/WebKit versions.
 */
import { IpadUnavailableError } from "../node/misc.ts";

const fail = (what: string) => (): never => { throw new IpadUnavailableError(what); };

// @resvg/resvg-js
export class Resvg {
	constructor() { throw new IpadUnavailableError("SVG rasterizing (resvg)"); }
}

// @napi-rs/canvas
export const createCanvas = fail("Native canvas (@napi-rs/canvas)");
export const loadImage = fail("Native canvas (@napi-rs/canvas)");

// puppeteer-core
export const launch = fail("Headless Chrome (puppeteer)");
export const connect = fail("Headless Chrome (puppeteer)");

export default { launch, connect, createCanvas, loadImage, Resvg };
