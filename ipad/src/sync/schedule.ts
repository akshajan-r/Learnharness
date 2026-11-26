/**
 * When sync runs: shortly after launch, when the app returns to the
 * foreground, a few seconds after each turn settles, and every 3 minutes
 * while the app is open — only when a laptop bridge is paired. An
 * unreachable laptop is normal (it's off, or you're away) and stays
 * silent; any other failure shows a small notice that fades out.
 */
import { bridgeConfig } from "../runtime/bridge.ts";
import { syncNow, type SyncReport } from "./client.ts";

const PERIOD_MS = 3 * 60_000;
const AFTER_TURN_MS = 4_000;
const AFTER_LAUNCH_MS = 6_000;

let lastNotice = "";

function notice(text: string): void {
	if (text === lastNotice) return; // once per distinct problem
	lastNotice = text;
	const el = document.createElement("div");
	el.setAttribute("role", "status");
	el.style.cssText = [
		"position:fixed", "right:max(12px, var(--lh-safe-right, 0px))", "bottom:calc(12px + var(--lh-safe-bottom, 0px))",
		"z-index:2147483646", "max-width:min(420px, calc(100vw - 24px))", "padding:10px 14px", "border-radius:10px",
		"background:rgba(30,30,30,.96)", "color:#eee", "border:1px solid #444", "font:12.5px/1.4 ui-sans-serif,system-ui",
		"box-shadow:0 8px 24px rgba(0,0,0,.4)", "transition:opacity .4s", "pointer-events:none",
	].join(";");
	el.textContent = `Sync with your laptop: ${text}`;
	document.body.appendChild(el);
	setTimeout(() => { el.style.opacity = "0"; }, 8_000);
	setTimeout(() => el.remove(), 8_600);
}

async function run(): Promise<SyncReport | null> {
	if (!bridgeConfig()) return null;
	try {
		const report = await syncNow();
		if (!report.ok && !report.quiet) notice(report.reason);
		if (report.ok) {
			lastNotice = "";
			if (report.graph === "skipped") notice("the knowledge graph wasn't synced because the two apps use different graph formats. Update both to the same version.");
		}
		return report;
	} catch (error) {
		console.error("[sync] failed", error);
		notice((error as Error).message);
		return null;
	}
}

export async function installSync(): Promise<void> {
	const { subscribe } = await import("@/src/core/events.ts");
	let afterTurn: ReturnType<typeof setTimeout> | null = null;
	subscribe((event) => {
		if (event.type !== "turn-settled") return;
		if (afterTurn) clearTimeout(afterTurn);
		afterTurn = setTimeout(() => { afterTurn = null; void run(); }, AFTER_TURN_MS);
	});
	document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void run(); });
	setInterval(() => { if (document.visibilityState === "visible") void run(); }, PERIOD_MS);
	setTimeout(() => void run(), AFTER_LAUNCH_MS);
	Object.assign(globalThis, { __lhSync: run });
}
