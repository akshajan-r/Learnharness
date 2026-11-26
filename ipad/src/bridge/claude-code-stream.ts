/**
 * src/agent/claude-code/stream.ts on iPad: the Claude Code engine runs on
 * the laptop bridge. Each call sends the model, context and options and
 * replays the engine's events into a local stream, so the agent loop sees
 * exactly what desktop produces. Cancelling (options.signal) aborts the
 * request, which stops the CLI turn on the laptop.
 */
import { createAssistantMessageEventStream, type Api, type AssistantMessage, type AssistantMessageEvent, type Model, type SimpleStreamOptions, type StreamFunction } from "@earendil-works/pi-ai";
import { BridgeUnavailableError, bridgeFetch, ndjsonLines } from "../runtime/bridge.ts";

function failure(model: Model<Api>, message: string, partial: AssistantMessage | null, aborted: boolean): AssistantMessageEvent {
	const base: AssistantMessage = partial ?? {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "error",
		timestamp: Date.now(),
	};
	const reason = aborted ? "aborted" : "error";
	return { type: "error", reason, error: { ...base, stopReason: reason, errorMessage: message } };
}

/** Options that survive JSON (no signal, callbacks or agents). */
function wireOptions(options: SimpleStreamOptions | undefined): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(options ?? {})) {
		if (key === "signal" || typeof value === "function") continue;
		out[key] = value;
	}
	return out;
}

export const streamClaudeCode: StreamFunction<Api, SimpleStreamOptions> = (model, context, options) => {
	const stream = createAssistantMessageEventStream();
	void (async () => {
		let partial: AssistantMessage | null = null;
		let finished = false;
		try {
			const res = await bridgeFetch("/v1/claude-code/stream", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ model, context, options: wireOptions(options) }),
				signal: options?.signal,
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null) as { error?: string } | null;
				throw new BridgeUnavailableError(body?.error ?? `The laptop bridge answered HTTP ${res.status}.`);
			}
			for await (const line of ndjsonLines(res)) {
				const event = line as AssistantMessageEvent;
				if ("partial" in event) partial = event.partial;
				stream.push(event);
				if (event.type === "done" || event.type === "error") { finished = true; break; }
			}
			if (!finished) throw new BridgeUnavailableError("The connection to the laptop bridge dropped before the reply finished.");
		} catch (error) {
			if (finished) return;
			const aborted = !!options?.signal?.aborted;
			const message = aborted ? "Request was aborted" : error instanceof Error ? error.message : String(error);
			stream.push(failure(model, message, partial, aborted));
		} finally {
			stream.end();
		}
	})();
	return stream;
};
