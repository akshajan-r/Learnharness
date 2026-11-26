/**
 * The iPad's HeadlessApi (src/agent/subagents/headless.ts): what desktop
 * does with headless Chrome, resvg and Skia, done with WebKit.
 *
 * - runDemo: the model's demo HTML runs in a hidden sandboxed iframe
 *   (allow-scripts only → an opaque origin, like desktop's about:blank page
 *   and the learner's own sandboxed demo frame). It cannot reach the app's
 *   DOM, storage or in-app API. Console errors, uncaught errors and failed
 *   resource loads are reported back by an injected capture script; the
 *   optional probe is evaluated inside the frame after it settles.
 * - renderSvg: WebKit rasterizes the SVG as an image, the same engine that
 *   shows figures to the learner on iPad (desktop uses resvg). As an image,
 *   an SVG runs no scripts and loads no external resources.
 * - renderPdfPages: desktop's own implementation; pdfjs paints into the
 *   OffscreenCanvas behind the @napi-rs/canvas shim.
 */
import { providerSafePng, realHeadless, type DemoRunResult, type HeadlessApi, type RenderSvgOptions, type RunDemoOptions } from "@/src/agent/subagents/headless.ts";
import { svgImageSource } from "@/lib/svg-image-source";
import { Buffer } from "../shims/node/buffer.ts";

// ── Demos ──

const CAPTURE = `<script>(function () {
	var post = function (kind, text) { try { parent.postMessage({ __lhDemo: kind, text: String(text) }, "*"); } catch (e) {} };
	var origError = console.error;
	console.error = function () {
		post("console", Array.prototype.map.call(arguments, function (a) { try { return typeof a === "string" ? a : (a && a.stack) || JSON.stringify(a); } catch (e) { return String(a); } }).join(" "));
		return origError.apply(console, arguments);
	};
	addEventListener("error", function (e) {
		var t = e.target;
		if (t && t !== window && (t.src || t.href)) post("request", (t.src || t.href) + " (failed to load)");
		else post("page", (e.error && e.error.message) || e.message);
	}, true);
	addEventListener("unhandledrejection", function (e) { post("page", (e.reason && e.reason.message) || e.reason); });
	addEventListener("message", function (e) {
		if (!e.data || e.data.__lhProbe === undefined) return;
		Promise.resolve().then(function () { return (0, eval)(e.data.__lhProbe); }).then(
			function (v) { var out; try { out = JSON.parse(JSON.stringify(v === undefined ? null : v)); } catch (x) { out = String(v); } parent.postMessage({ __lhDemo: "probe", value: out }, "*"); },
			function (err) { parent.postMessage({ __lhDemo: "probe-error", text: String((err && err.message) || err) }, "*"); });
	});
})();</script>`;

function withCapture(html: string): string {
	const doctype = html.match(/^\s*<!doctype[^>]*>/i);
	return doctype ? doctype[0] + CAPTURE + html.slice(doctype[0].length) : CAPTURE + html;
}

async function runDemo(html: string, opts: RunDemoOptions = {}): Promise<DemoRunResult> {
	const settleMs = opts.settleMs ?? 2000;
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	const failedRequests: string[] = [];
	let probeResult: unknown;
	let probed = false;

	const frame = document.createElement("iframe");
	frame.setAttribute("sandbox", "allow-scripts");
	frame.setAttribute("aria-hidden", "true");
	frame.tabIndex = -1;
	// Laid out at a real size (demos measure themselves), but off screen.
	frame.style.cssText = "position:fixed;left:-20000px;top:0;width:1024px;height:768px;border:0;visibility:hidden;pointer-events:none";

	let onProbe: ((data: { __lhDemo: string; value?: unknown; text?: string }) => void) | null = null;
	const onMessage = (event: MessageEvent) => {
		if (event.source !== frame.contentWindow || !event.data || typeof event.data.__lhDemo !== "string") return;
		const { __lhDemo: kind, text } = event.data as { __lhDemo: string; text?: string };
		if (kind === "console") consoleErrors.push(text ?? "");
		else if (kind === "page") pageErrors.push(text ?? "");
		else if (kind === "request") failedRequests.push(text ?? "");
		else if (kind === "probe" || kind === "probe-error") onProbe?.(event.data);
	};
	addEventListener("message", onMessage);
	try {
		const loaded = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
		frame.srcdoc = withCapture(html);
		document.body.appendChild(frame);
		await Promise.race([loaded, new Promise((r) => setTimeout(r, 30_000))]);
		await new Promise((r) => setTimeout(r, settleMs));
		if (opts.probe) {
			const result = await new Promise<{ __lhDemo: string; value?: unknown; text?: string } | null>((resolve) => {
				onProbe = resolve;
				frame.contentWindow?.postMessage({ __lhProbe: opts.probe }, "*");
				setTimeout(() => resolve(null), 10_000);
			});
			if (!result) pageErrors.push("probe failed: no answer from the demo within 10s");
			else if (result.__lhDemo === "probe-error") pageErrors.push(`probe failed: ${result.text}`);
			else probeResult = result.value;
			probed = true;
		}
	} catch (err) {
		pageErrors.push(err instanceof Error ? err.message : String(err));
	} finally {
		removeEventListener("message", onMessage);
		frame.remove();
	}
	return {
		consoleErrors,
		pageErrors,
		failedRequests,
		...(probed ? { probeResult } : {}),
		ok: consoleErrors.length === 0 && pageErrors.length === 0 && failedRequests.length === 0,
	};
}

// ── SVG figures ──

/** Desktop's viewport rule (headless.ts svgViewport). */
function svgViewport(svg: string, opts: RenderSvgOptions): { width: number; height: number } {
	if (opts.width && opts.height) return { width: opts.width, height: opts.height };
	const width = Number(svg.match(/\bwidth\s*=\s*"?(\d+(?:\.\d+)?)/)?.[1]);
	const height = Number(svg.match(/\bheight\s*=\s*"?(\d+(?:\.\d+)?)/)?.[1]);
	return {
		width: Math.ceil(Number.isFinite(width) && width > 0 ? width : 900),
		height: Math.ceil(Number.isFinite(height) && height > 0 ? height : 700),
	};
}

async function renderSvg(svg: string, opts: RenderSvgOptions = {}): Promise<Buffer> {
	const source = opts.nativeOnly ? svg : svgImageSource(svg);
	const viewport = svgViewport(source, opts);
	const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
	try {
		const img = new Image();
		img.decoding = "sync";
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error("The SVG could not be parsed or rendered."));
			img.src = url;
		});
		// Fit to the viewport width, keeping the SVG's own aspect (resvg's fitTo: width).
		const aspect = img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalHeight / img.naturalWidth : viewport.height / viewport.width;
		const width = viewport.width;
		const height = Math.max(1, Math.round(width * aspect));
		const canvas = new OffscreenCanvas(width, height);
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Could not create a canvas to render the SVG");
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, width, height);
		ctx.drawImage(img, 0, 0, width, height);
		const blob = await canvas.convertToBlob({ type: "image/png" });
		return providerSafePng(Buffer.from(await blob.arrayBuffer()) as unknown as globalThis.Buffer) as unknown as Buffer;
	} finally {
		URL.revokeObjectURL(url);
	}
}

export const ipadHeadless: HeadlessApi = {
	available: () => true,
	unavailableReason: () => null,
	runDemo,
	renderSvg: renderSvg as HeadlessApi["renderSvg"],
	renderPdfPages: realHeadless.renderPdfPages,
};
