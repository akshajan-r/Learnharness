import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const shim = (file: string) => path.join(here, "src", "shims", file);
const require = createRequire(import.meta.url);
/** Aliases must be absolute paths or Vite duplicates the module per importer. */
const pkg = (name: string) => require.resolve(name, { paths: [here] });

/** The virtual location the app's read-only files live at on iPad. */
export const VIRTUAL_ROOT = "/app";

/**
 * LearnHarness source derives disk paths from import.meta.url (config.ts's
 * ROOT, the PDF fonts, …). Rewrite it in repo source — never in
 * dependencies, which use it to locate their own bundled assets — so those
 * paths land inside the virtual file system at the same relative place.
 */
function virtualImportMetaUrl(): Plugin {
	const sourceDirs = ["src", "lib", "components", "app", "config.ts"].map((p) => path.join(repoRoot, p));
	return {
		name: "lh-virtual-import-meta-url",
		enforce: "pre",
		transform(code, id) {
			const file = id.split("?")[0]!;
			if (!file.includes("import.meta.url") && !code.includes("import.meta.url")) return null;
			if (file.includes(`${path.sep}node_modules${path.sep}`) || file.includes("/node_modules/")) return null;
			const normalized = path.normalize(file);
			if (!sourceDirs.some((dir) => normalized === dir || normalized.startsWith(dir + path.sep))) return null;
			const rel = path.relative(repoRoot, normalized).split(path.sep).join("/");
			return { code: code.replaceAll("import.meta.url", JSON.stringify(`file://${VIRTUAL_ROOT}/${rel}`)), map: null };
		},
	};
}

/**
 * pdfjs's standard fonts, served where standardFontsDir() (pdf-ops.ts)
 * points once import.meta.url is virtual: /app/node_modules/pdfjs-dist/
 * standard_fonts/. In the browser pdfjs fetches them as URLs.
 */
function pdfjsStandardFonts(): Plugin {
	const source = path.join(path.dirname(require.resolve("pdfjs-dist/package.json", { paths: [repoRoot] })), "standard_fonts");
	const prefix = `${VIRTUAL_ROOT}/node_modules/pdfjs-dist/standard_fonts/`;
	return {
		name: "lh-pdfjs-standard-fonts",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (!req.url?.startsWith(prefix)) return next();
				const file = path.join(source, path.basename(decodeURIComponent(req.url.slice(prefix.length).split("?")[0]!)));
				if (!fs.existsSync(file)) return next();
				res.setHeader("Content-Type", "application/octet-stream");
				fs.createReadStream(file).pipe(res);
			});
		},
		generateBundle() {
			for (const name of fs.readdirSync(source)) {
				this.emitFile({ type: "asset", fileName: `${prefix.slice(1)}${name}`, source: fs.readFileSync(path.join(source, name)) });
			}
		},
	};
}

/**
 * The app-shipped core plugins (core-plugins/, built by `npm run
 * plugins:build-core`) as static files at /app/core-plugins/<id>/…, plus
 * "virtual:lh-core-plugin-files", the list boot loads into the virtual file
 * system (src/runtime/plugins.ts).
 */
function corePlugins(): Plugin {
	const source = path.join(repoRoot, "core-plugins");
	const prefix = `${VIRTUAL_ROOT}/core-plugins/`;
	const id = "virtual:lh-core-plugin-files";
	const list = (): string[] => {
		if (!fs.existsSync(source)) {
			throw new Error("core-plugins/ is missing: run `npm run plugins:setup && npm run plugins:build-core` in the repo root first.");
		}
		const out: string[] = [];
		const walk = (rel: string) => {
			for (const name of fs.readdirSync(path.join(source, rel)).sort()) {
				const file = rel ? `${rel}/${name}` : name;
				if (fs.statSync(path.join(source, file)).isDirectory()) walk(file);
				else out.push(file);
			}
		};
		walk("");
		return out;
	};
	return {
		name: "lh-core-plugins",
		resolveId: (request) => (request === id ? `\0${id}` : null),
		load: (request) => (request === `\0${id}` ? `export default ${JSON.stringify(list())};` : null),
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (!req.url?.startsWith(prefix)) return next();
				const rel = decodeURIComponent(req.url.slice(prefix.length).split("?")[0]!);
				const file = path.resolve(source, rel);
				if (!file.startsWith(source + path.sep) || !fs.existsSync(file)) return next();
				const ext = path.extname(file);
				res.setHeader("Content-Type", ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : "application/octet-stream");
				fs.createReadStream(file).pipe(res);
			});
		},
		generateBundle() {
			for (const rel of list()) {
				this.emitFile({ type: "asset", fileName: `${prefix.slice(1)}${rel}`, source: fs.readFileSync(path.join(source, rel)) });
			}
		},
	};
}

const nodeShims: Record<string, string> = {
	fs: shim("node/fs.ts"),
	"fs/promises": shim("node/fs-promises.ts"),
	path: pkg("path-browserify"),
	crypto: shim("node/crypto.ts"),
	os: shim("node/os.ts"),
	url: shim("node/url.ts"),
	async_hooks: shim("node/async_hooks.ts"),
	util: shim("node/util.ts"),
	net: shim("node/net.ts"),
	module: shim("node/module.ts"),
	child_process: shim("node/child_process.ts"),
	worker_threads: shim("node/worker_threads.ts"),
	http: shim("node/http.ts"),
	https: shim("node/http.ts"),
	readline: shim("node/readline.ts"),
	events: pkg("events/"),
	stream: pkg("stream-browserify"),
	string_decoder: pkg("string_decoder/"),
	assert: pkg("assert/"),
	buffer: shim("node/buffer.ts"),
};

const alias = [
	{ find: /^@\//, replacement: `${repoRoot}/` },
	{ find: /^next\/navigation$/, replacement: shim("next/navigation.ts") },
	{ find: /^next\/link$/, replacement: shim("next/link.tsx") },
	{ find: /^next\/server$/, replacement: shim("next/server.ts") },
	{ find: /^undici$/, replacement: shim("node/undici.ts") },
	// Native add-ons and headless Chrome: no iPad build (see the shim).
	// Skia canvas → WebKit OffscreenCanvas (pdfjs page rendering).
	{ find: /^@napi-rs\/canvas$/, replacement: shim("native/canvas.ts") },
	// photon-node (Node WASM loader) → photon's browser build.
	{ find: /^@silvia-odwyer\/photon-node$/, replacement: shim("native/photon.ts") },
	{ find: /^(@resvg\/resvg-js|puppeteer-core)$/, replacement: shim("unavailable/native.ts") },
	...Object.entries(nodeShims).flatMap(([name, target]) => [
		{ find: new RegExp(`^node:${name.replace("/", "\\/")}$`), replacement: target },
		{ find: new RegExp(`^${name.replace("/", "\\/")}$`), replacement: target },
	]),
];

// Tailwind v4 scans for class names from its base; the components live in
// the repo root, not in ipad/.
const tailwind = require(require.resolve("@tailwindcss/postcss", { paths: [repoRoot] }));

export default defineConfig({
	root: here,
	// Absolute asset URLs: in-app routes like /chat/<id> are history paths.
	base: "/",
	// Fonts, plugin loader assets, worklets — shared with desktop.
	publicDir: path.join(repoRoot, "public"),
	css: { postcss: { plugins: [tailwind({ base: repoRoot })] } },
	plugins: [virtualImportMetaUrl(), pdfjsStandardFonts(), corePlugins(), react()],
	resolve: { alias },
	define: {
		"process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
		// Vite otherwise rewrites `process.env` to `{}` in browser builds; the
		// server reads LH_DATA_DIR, keys, etc. from the runtime object that
		// src/runtime/node-globals.ts installs.
		"process.env": "globalThis.process.env",
		"process.env.LH_VERSION": JSON.stringify(process.env.npm_package_version ?? "ipad"),
	},
	server: { fs: { allow: [repoRoot] } },
	build: {
		outDir: "dist",
		emptyOutDir: true,
		target: "safari17",
		chunkSizeWarningLimit: 20_000,
		// Readable stacks while the port is being brought up.
		minify: process.env.LH_IPAD_MINIFY === "1",
		sourcemap: process.env.LH_IPAD_SOURCEMAP === "1",
	},
});
