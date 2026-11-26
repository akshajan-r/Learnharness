/** Image normalization/resizing off the main thread (see runtime/image-jobs.ts). */
import "../runtime/node-globals.ts";
import { runImageJob, type ImageJob } from "../runtime/image-jobs.ts";

self.onmessage = async (event: MessageEvent<{ id: number; job: ImageJob; message: unknown }>) => {
	const { id, job, message } = event.data;
	try {
		self.postMessage({ id, reply: await runImageJob(job, message) });
	} catch (error) {
		self.postMessage({ id, crash: error instanceof Error ? error.message : String(error) });
	}
};
