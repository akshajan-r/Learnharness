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
	{ find: /^(@resvg\/resvg-js|@napi-rs\/canvas|puppeteer-core|@silvia-odwyer\/photon-node)$/, replacement: shim("unavailable/native.ts") },
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
	plugins: [virtualImportMetaUrl(), react()],
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
