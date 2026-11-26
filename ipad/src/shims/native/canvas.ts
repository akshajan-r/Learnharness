/**
 * @napi-rs/canvas for the iPad runtime: the subset pdfjs page rendering
 * uses (headless.ts paintPdfPage, pdf-figure crops). A WebKit
 * OffscreenCanvas hosts pdfjs's painting; toBuffer("image/png") encodes
 * synchronously like Skia's, with a pure-JS PNG encoder.
 */
import { encode } from "fast-png";
import { Buffer } from "../node/buffer.ts";

export class Canvas {
	readonly #canvas: OffscreenCanvas;
	constructor(width: number, height: number) {
		this.#canvas = new OffscreenCanvas(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
	}
	get width(): number { return this.#canvas.width; }
	set width(value: number) { this.#canvas.width = value; }
	get height(): number { return this.#canvas.height; }
	set height(value: number) { this.#canvas.height = value; }
	getContext(type: "2d", options?: CanvasRenderingContext2DSettings): OffscreenCanvasRenderingContext2D {
		const ctx = this.#canvas.getContext(type, options);
		if (!ctx) throw new Error("Could not create a 2D canvas (out of memory?)");
		return ctx;
	}
	toBuffer(mime = "image/png"): Buffer {
		if (mime !== "image/png") throw new Error(`canvas: ${mime} encoding is not available on iPad`);
		const ctx = this.getContext("2d");
		const { data, width, height } = ctx.getImageData(0, 0, this.#canvas.width, this.#canvas.height);
		const png = encode({ width, height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), channels: 4, depth: 8 });
		return Buffer.from(png) as unknown as Buffer;
	}
}

export function createCanvas(width: number, height: number): Canvas {
	return new Canvas(width, height);
}

export default { Canvas, createCanvas };
