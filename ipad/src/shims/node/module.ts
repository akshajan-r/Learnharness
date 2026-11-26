/**
 * node:module for the iPad runtime.
 *
 * The plugin host (src/server/plugin-host.ts) loads plugin backends with
 * createRequire(<app>/scripts/plugin-loader.cjs) and that sidecar's
 * load(filename). Here the sidecar is provided in-process: load() reads the
 * backend's CommonJS file from the virtual file system and runs it with a
 * require() that resolves Node built-ins to the iPad stand-ins. Plugins are
 * trusted local code on desktop too (no sandbox); on iPad only the
 * app-shipped core plugins are present.
 *
 * Any other createRequire use is unavailable.
 */
import pathModule from "path-browserify";
import fs from "./fs.ts";
import crypto from "./crypto.ts";
import os from "./os.ts";
import url from "./url.ts";
import util from "./util.ts";
import childProcess from "./child_process.ts";
import events from "events";
import { IpadUnavailableError } from "./misc.ts";

const BUILTINS: Record<string, unknown> = {
	fs,
	"fs/promises": fs.promises,
	path: pathModule,
	crypto,
	os,
	url,
	util,
	events,
	child_process: childProcess,
};

function requireBuiltin(id: string): unknown {
	const name = id.replace(/^node:/, "");
	if (name in BUILTINS) return BUILTINS[name];
	throw new IpadUnavailableError(`The Node module "${id}"`);
}

const cache = new Map<string, unknown>();

function loadCommonJs(filename: string): unknown {
	if (cache.has(filename)) return cache.get(filename);
	const code = fs.readFileSync(filename, "utf8") as string;
	const module = { exports: {} as unknown };
	const dirname = pathModule.dirname(filename);
	// sourceURL names the plugin in Safari Web Inspector stack traces.
	const run = new Function("module", "exports", "require", "__filename", "__dirname", `${code}\n//# sourceURL=${filename}`);
	run(module, module.exports, requireBuiltin, filename, dirname);
	cache.set(filename, module.exports);
	return module.exports;
}

const pluginLoader = {
	load(filename: string): unknown {
		if (!pathModule.isAbsolute(filename)) throw new Error("Plugin entrypoint must be absolute");
		return loadCommonJs(filename);
	},
};

export function createRequire(from: string | URL): (id: string) => unknown {
	const origin = String(from);
	return (id: string) => {
		if (/[\\/]scripts[\\/]plugin-loader\.cjs$/.test(id) && /[\\/]scripts[\\/]plugin-loader\.cjs$/.test(origin)) return pluginLoader;
		if (id.startsWith("node:") || id in BUILTINS) return requireBuiltin(id);
		throw new IpadUnavailableError(`Loading "${id}" at runtime`);
	};
}

export default { createRequire };
