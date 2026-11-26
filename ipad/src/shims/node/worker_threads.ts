/**
 * node:worker_threads for the iPad runtime.
 *
 * LearnHarness starts two kinds of Node workers, both for image
 * processing (src/agent/image-processing/*-worker.mjs). iPad has no Node
 * workers, so those two run in-process here with their exact logic and
 * message protocol: postMessage() → 'message' with the result. Any other
 * worker script is unavailable and fails like a worker that can't start.
 */
import { EventEmitter } from "events";
import { IpadUnavailableError } from "./misc.ts";

type Handler = (message: unknown) => Promise<unknown>;

const handlers: Record<string, Handler> = {
	// learner-image-worker.mjs
	"learner-image-worker.mjs": async (message) => {
		const { bytes } = message as { bytes: Uint8Array };
		try {
			const [{ convertImageBytesToPng }, { resizeImageInProcess }] = await Promise.all([
				import("@/src/agent/image-processing/convert.mjs"),
				import("@/src/agent/image-processing/resize-core.mjs"),
			]);
			const png = await convertImageBytesToPng(bytes);
			if (!png) throw new Error("Could not decode image");
			const result = await resizeImageInProcess(png, "image/png", { maxWidth: 1600, maxHeight: 1600, maxBytes: 1024 * 1024 });
			if (!result) throw new Error("Could not shrink image to an embeddable size");
			return { result };
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		}
	},
	// resize-worker.mjs
	"resize-worker.mjs": async (message) => {
		const { IMAGE_RESIZE_WORKER_RESPONSE_TYPE, resizeImageInProcess } = await import("@/src/agent/image-processing/resize-core.mjs");
		try {
			const { inputBytes, mimeType, options } = message as { inputBytes: Uint8Array; mimeType: string; options?: unknown };
			if (!(inputBytes instanceof Uint8Array) || typeof mimeType !== "string") throw new Error("Invalid image resize worker request");
			return { type: IMAGE_RESIZE_WORKER_RESPONSE_TYPE, result: await resizeImageInProcess(inputBytes, mimeType, options as never) };
		} catch (error) {
			return { type: IMAGE_RESIZE_WORKER_RESPONSE_TYPE, error: error instanceof Error ? error.message : String(error) };
		}
	},
};

export class Worker extends EventEmitter {
	#handler: Handler;
	#terminated = false;
	constructor(filename: string | URL) {
		super();
		const name = String(filename).split(/[\/]/).pop() ?? "";
		const handler = handlers[name];
		if (!handler) throw new IpadUnavailableError(`Node worker threads (${name})`);
		this.#handler = handler;
	}
	postMessage(message: unknown): void {
		// Asynchronous like a real worker; listeners are attached by now.
		queueMicrotask(async () => {
			try {
				const reply = await this.#handler(message);
				if (!this.#terminated) this.emit("message", reply);
			} catch (error) {
				if (!this.#terminated) this.emit("error", error);
			}
		});
	}
	terminate(): Promise<number> {
		this.#terminated = true;
		return Promise.resolve(0);
	}
	ref(): this { return this; }
	unref(): this { return this; }
}

export const parentPort = null;
export const isMainThread = true;
export const workerData = undefined;
export default { Worker, parentPort, isMainThread, workerData };
