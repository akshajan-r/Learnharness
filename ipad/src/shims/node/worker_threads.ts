/**
 * node:worker_threads for the iPad runtime.
 *
 * LearnHarness starts two kinds of Node workers, both for image
 * processing (src/agent/image-processing/*-worker.mjs). iPad has no Node
 * workers, so those two run in a Web Worker (runtime/image-jobs.ts, falling
 * back to in-process) with their exact logic and message protocol:
 * postMessage() → 'message' with the result. Any other worker script is
 * unavailable and fails like a worker that can't start.
 */
import { EventEmitter } from "events";
import { IpadUnavailableError } from "./misc.ts";
import { runImageJobOffThread, type ImageJob } from "../../runtime/image-jobs.ts";

const JOBS = new Set<ImageJob>(["learner-image-worker.mjs", "resize-worker.mjs"]);

export class Worker extends EventEmitter {
	#job: ImageJob;
	#terminated = false;
	constructor(filename: string | URL) {
		super();
		const name = String(filename).split(/[\/]/).pop() ?? "";
		if (!JOBS.has(name as ImageJob)) throw new IpadUnavailableError(`Node worker threads (${name})`);
		this.#job = name as ImageJob;
	}
	postMessage(message: unknown): void {
		// Asynchronous like a real worker; listeners are attached by now.
		queueMicrotask(async () => {
			try {
				const reply = await runImageJobOffThread(this.#job, message);
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
