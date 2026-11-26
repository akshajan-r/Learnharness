/**
 * iPad app entry. Order matters:
 *   1. Node globals (process, Buffer) — before any server module.
 *   2. Restore saved learning data into the in-memory file system and
 *      install the bundled prompt files.
 *   3. Route /api fetches and EventSources in-process.
 *   4. Import the server (its modules read settings/env at load), run the
 *      desktop's instrumentation hook equivalent, then render.
 */
import "./runtime/node-globals.ts";
import { restore, flush } from "./runtime/persistence.ts";
import { vol } from "./shims/node/fs.ts";
import { installAppAssets } from "./runtime/assets.ts";
import { installApiFetch } from "./runtime/api.ts";

function fail(error: unknown) {
	console.error(error);
	const root = document.getElementById("root")!;
	root.style.cssText = "padding:24px;font:13px ui-monospace,monospace;white-space:pre-wrap;color:#ddd;background:#141414;min-height:100dvh";
	root.textContent = `LearnHarness couldn't start.\n\n${error instanceof Error ? error.stack ?? error.message : String(error)}`;
}

async function boot() {
	// Inspection handle for dev checks (scripts/*.mjs) and Safari Web Inspector.
	Object.assign(globalThis, { __lh: { vol, flush } });
	await restore();
	installAppAssets();
	installApiFetch();

	await import("katex/dist/katex.min.css");
	await import("@/app/globals.css");
	await import("./app/fonts.css");

	const server = await import("@/src/server");
	const { initializeModelCatalog } = await import("@/src/server/remote-model-catalog.ts");
	initializeModelCatalog();
	try { await server.initializePlugins(); }
	catch (error) { console.error("[plugins] Initialization failed; plugin management will report the error:", error); }

	const boot = server.readThemeBoot();
	const html = document.documentElement;
	html.className = `${boot.theme.mode}`;
	for (const [name, value] of Object.entries(boot.vars as Record<string, string>)) html.style.setProperty(name, value);
	document.body.className = "min-h-dvh antialiased";

	const [{ createRoot }, { App }] = await Promise.all([import("react-dom/client"), import("./app/App.tsx")]);
	createRoot(document.getElementById("root")!).render(<App boot={boot} />);
}

boot().catch(fail);
