/**
 * Attachments on iPad.
 *
 * Desktop attaches files by path: Electron's window.lh.getPathForFile(file)
 * turns a picked or dropped File into its disk path, and only that path
 * enters the draft. An iPad File (from Files, Photos, the camera or a drag
 * in Split View) has no path, so this bridge copies it into
 * /data/Attachments, which is the learner's home folder here and appears
 * in the Files app as On My iPad › LearnHarness › Attachments, and returns
 * that path. Everything after (path chips, the agent's read/show_image/PDF
 * tools) is unchanged.
 *
 * getPathForFile must answer synchronously, so the copy finishes in the
 * background a moment later. Files added in the Files app are visible on
 * the next launch.
 */
import { vol } from "../shims/node/fs.ts";
import { HOME } from "../shims/node/misc.ts";

const pending = new Set<string>();

function safeName(name: string): string {
	const cleaned = name.replace(/[/\:\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim();
	return cleaned || "attachment";
}

function uniquePath(name: string): string {
	const dot = name.lastIndexOf(".");
	const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
	for (let n = 1; ; n++) {
		const candidate = `${HOME}/${n === 1 ? name : `${stem} (${n})${ext}`}`;
		if (!vol.existsSync(candidate) && !pending.has(candidate)) return candidate;
	}
}

export function getPathForFile(file: File): string {
	vol.mkdirSync(HOME, { recursive: true });
	const target = uniquePath(safeName(file.name));
	pending.add(target);
	void file.arrayBuffer()
		.then((bytes) => { vol.writeFileSync(target, new Uint8Array(bytes)); })
		.catch((error) => console.error(`[attachments] could not copy ${file.name}`, error))
		.finally(() => pending.delete(target));
	return target;
}

export function installAttachmentBridge(): void {
	vol.mkdirSync(HOME, { recursive: true });
	const w = window as unknown as { lh?: Record<string, unknown> };
	w.lh = { ...(w.lh ?? {}), getPathForFile };
}
