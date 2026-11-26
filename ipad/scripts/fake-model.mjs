/**
 * A tiny OpenAI-compatible chat server for end-to-end checks without a real
 * key. Answers every request with a short streamed text reply. CORS open,
 * because the iPad runtime calls providers straight from the web view.
 *   node scripts/fake-model.mjs [port]
 */
import http from "node:http";
const port = Number(process.argv[2] ?? 8787);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
let requests = 0;
http.createServer(async (req, res) => {
	if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
	if (req.url.endsWith("/models")) {
		res.writeHead(200, { ...cors, "Content-Type": "application/json" });
		return res.end(JSON.stringify({ object: "list", data: [{ id: "fake-tutor", object: "model", context_length: 32000 }] }));
	}
	let body = ""; for await (const c of req) body += c;
	requests++;
	console.log(`[fake-model] request ${requests}: ${req.method} ${req.url} (${body.length} bytes)`);
	res.writeHead(200, { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
	const words = "Hello from the fake tutor. This reply streamed through the in-app server on iPad.".split(" ");
	const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "fake-tutor", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
	res.write(chunk({ role: "assistant", content: "" }));
	for (const w of words) { res.write(chunk({ content: w + " " })); await new Promise((r) => setTimeout(r, 15)); }
	res.write(chunk({}, "stop"));
	res.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "fake-tutor", choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`);
	res.end("data: [DONE]\n\n");
}).listen(port, () => console.log(`[fake-model] listening on http://localhost:${port}/v1`));
