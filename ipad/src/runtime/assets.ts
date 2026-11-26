/**
 * Read-only files the server loads from the app root at runtime (system
 * prompts and prompt segments). On desktop they ship inside the app bundle;
 * here Vite embeds them and boot writes them into the virtual /app tree at
 * the same relative paths, so PATHS.root lookups work unchanged.
 */
import { vol } from "../shims/node/fs.ts";
import { APP_ROOT } from "./node-globals.ts";

const prompts = import.meta.glob("../../../src/agent/**/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export function installAppAssets(): number {
	let count = 0;
	for (const [key, text] of Object.entries(prompts)) {
		const rel = key.replace(/^(\.\.\/)+/, "");
		const target = `${APP_ROOT}/${rel}`;
		vol.mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
		vol.writeFileSync(target, text);
		count++;
	}
	return count;
}
