/**
 * Core plugins on iPad.
 *
 * The four app-shipped plugins (core-plugins.json) are built into the web
 * bundle as static files at /app/core-plugins/<id>/… (vite.config.ts).
 *
 * - Server side: boot copies them into the virtual file system at the same
 *   path (PATHS.root/core-plugins), so the unchanged plugin host discovers,
 *   fingerprints and activates them; backends load through the node:module
 *   shim.
 * - Browser side: the host's asset URLs (/api/plugins/<id>/assets/<file>)
 *   are answered by the in-app API for fetch(), but module imports and
 *   stylesheet <link>s bypass fetch. Those are pointed at the static copies,
 *   which also keeps relative chunk, font and worker URLs inside a plugin
 *   working.
 *
 * Community plugins (installed into learning data) aren't supported on iPad.
 */
import files from "virtual:lh-core-plugin-files";
import { vol } from "../shims/node/fs.ts";
import { APP_ROOT } from "./node-globals.ts";

const STATIC_PREFIX = `${APP_ROOT}/core-plugins/`;
const ASSET_URL = /^\/api\/plugins\/([^/?#]+)\/assets\/([^?#]+)/;

/** /api/plugins/<id>/assets/<file>?revision=… → /app/core-plugins/<id>/<file> */
function staticUrl(input: string): string {
	const url = new URL(input, location.href);
	if (url.origin !== location.origin) return input;
	const match = url.pathname.match(ASSET_URL);
	if (!match) return input;
	const id = decodeURIComponent(match[1]!);
	const file = match[2]!.split("/").map(decodeURIComponent).join("/");
	if (!files.includes(`${id}/${file}`)) return input; // not a core plugin file: leave to the API
	return `${STATIC_PREFIX}${encodeURIComponent(id)}/${file.split("/").map(encodeURIComponent).join("/")}`;
}

/** Copy the core plugin packages into the virtual file system. */
export async function installCorePluginFiles(): Promise<number> {
	let next = 0;
	const worker = async () => {
		while (next < files.length) {
			const rel = files[next++]!;
			const res = await fetch(`${STATIC_PREFIX}${rel}`);
			if (!res.ok) throw new Error(`Missing core plugin file ${rel} (HTTP ${res.status})`);
			const target = `${STATIC_PREFIX}${rel}`;
			vol.mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
			vol.writeFileSync(target, new Uint8Array(await res.arrayBuffer()));
		}
	};
	await Promise.all(Array.from({ length: 12 }, worker));
	return files.length;
}

export function installPluginAssetUrls(): void {
	(window as unknown as { __lhImportPlugin?: (url: string) => Promise<unknown> }).__lhImportPlugin =
		(url: string) => import(/* @vite-ignore */ staticUrl(url));

	const descriptor = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, "href")!;
	Object.defineProperty(HTMLLinkElement.prototype, "href", {
		...descriptor,
		set(this: HTMLLinkElement, value: string) { descriptor.set!.call(this, staticUrl(String(value))); },
	});
}
