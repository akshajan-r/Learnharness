/**
 * The two Node image workers' jobs (src/agent/image-processing/*-worker.mjs),
 * with their exact logic and reply shapes. They run in a Web Worker
 * (src/workers/image.worker.ts) so a large photo doesn't freeze the app,
 * or in-process when a worker can't start.
 */
export type ImageJob = "learner-image-worker.mjs" | "resize-worker.mjs";

export async function runImageJob(job: ImageJob, message: unknown): Promise<unknown> {
	if (job === "learner-image-worker.mjs") {
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
	}
	const { IMAGE_RESIZE_WORKER_RESPONSE_TYPE, resizeImageInProcess } = await import("@/src/agent/image-processing/resize-core.mjs");
	try {
		const { inputBytes, mimeType, options } = message as { inputBytes: Uint8Array; mimeType: string; options?: unknown };
		if (!(inputBytes instanceof Uint8Array) || typeof mimeType !== "string") throw new Error("Invalid image resize worker request");
		return { type: IMAGE_RESIZE_WORKER_RESPONSE_TYPE, result: await resizeImageInProcess(inputBytes, mimeType, options as never) };
	} catch (error) {
		return { type: IMAGE_RESIZE_WORKER_RESPONSE_TYPE, error: error instanceof Error ? error.message : String(error) };
	}
}

// ── Web Worker pool (one worker, requests multiplexed by id) ──

let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

function getWorker(): Worker | null {
	if (worker !== undefined) return worker;
	try {
		worker = new Worker(new URL("../workers/image.worker.ts", import.meta.url), { type: "module" });
		worker.onmessage = (event: MessageEvent<{ id: number; reply?: unknown; crash?: string }>) => {
			const entry = pending.get(event.data.id);
			if (!entry) return;
			pending.delete(event.data.id);
			if (event.data.crash !== undefined) entry.reject(new Error(event.data.crash));
			else entry.resolve(event.data.reply);
		};
		worker.onerror = (event) => {
			// A worker that fails to load or crashes: fail its jobs over to
			// in-process and stop using it.
			console.error("[images] worker failed; processing in-process from now on", event.message);
			worker = null;
			for (const [, entry] of pending) entry.reject(new Error("image worker failed"));
			pending.clear();
		};
	} catch (error) {
		console.warn("[images] no Web Worker; processing in-process", error);
		worker = null;
	}
	return worker;
}

/** Run a job off the main thread, falling back to in-process. */
export async function runImageJobOffThread(job: ImageJob, message: unknown): Promise<unknown> {
	const w = getWorker();
	if (!w) return runImageJob(job, message);
	try {
		return await new Promise((resolve, reject) => {
			const id = nextId++;
			pending.set(id, { resolve, reject });
			w.postMessage({ id, job, message });
		});
	} catch {
		return runImageJob(job, message);
	}
}
