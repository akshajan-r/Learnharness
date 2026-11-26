/**
 * On-device event diagnostics.
 *
 * Some iPad-only behavior (how iPadOS turns a tap into touch, pointer,
 * mouse, focus and click events) can't be reproduced off the device. This
 * overlay lists those events as they happen — the element each one hit,
 * whether something prevented its default — plus file-picker requests and
 * uncaught errors, so a screenshot of one attempt shows where a tap goes.
 *
 * Toggle: tap the top-left corner (the logo) 5 times within 2 seconds.
 * The choice is remembered. The overlay ignores touches, apart from its
 * own Clear and × buttons.
 */
const STORAGE_KEY = "lh-ipad-diagnostics";
const MAX_LINES = 40;
const EVENTS = [
	"touchstart", "touchend", "touchcancel",
	"pointerdown", "pointerup", "pointercancel",
	"mousedown", "mouseup", "click",
	"focusin", "focusout", "change",
] as const;

let panel: HTMLDivElement | null = null;
let list: HTMLOListElement | null = null;
const t0 = performance.now();

function describe(target: EventTarget | null): string {
	if (!(target instanceof Element)) return target === window ? "window" : target === document ? "document" : String(target);
	const el = target.closest("button, a, input, textarea, [role], [data-testid], [contenteditable]") ?? target;
	const tag = el.tagName.toLowerCase();
	const testid = el.getAttribute("data-testid");
	const role = el.getAttribute("role");
	const type = el instanceof HTMLInputElement ? `:${el.type}` : "";
	const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 14);
	return `${tag}${type}${testid ? `#${testid}` : ""}${role ? `[${role}]` : ""}${text ? ` "${text}"` : ""}${el !== target ? ` <${target.tagName.toLowerCase()}>` : ""}`;
}

function log(text: string): HTMLLIElement | null {
	if (!list) return null;
	const item = document.createElement("li");
	item.textContent = `${String(Math.round(performance.now() - t0)).padStart(6)} ${text}`;
	list.appendChild(item);
	while (list.children.length > MAX_LINES) list.firstElementChild?.remove();
	list.scrollTop = list.scrollHeight;
	return item;
}

function show(): void {
	if (panel) return;
	panel = document.createElement("div");
	panel.setAttribute("data-lh-diagnostics", "");
	panel.style.cssText = [
		"position:fixed", "left:8px", "bottom:8px", "z-index:2147483647", "width:min(440px,calc(100vw - 16px))",
		"max-height:45vh", "display:flex", "flex-direction:column", "background:rgba(0,0,0,.82)", "color:#9fe870",
		"font:10.5px/1.35 ui-monospace,Menlo,monospace", "border:1px solid #555", "border-radius:8px", "pointer-events:none",
	].join(";");
	const bar = document.createElement("div");
	bar.style.cssText = "display:flex;gap:8px;align-items:center;padding:4px 6px;border-bottom:1px solid #444;color:#ddd";
	bar.textContent = "Event trace";
	const clear = document.createElement("span");
	clear.textContent = "Clear";
	const close = document.createElement("span");
	close.textContent = "×";
	for (const control of [clear, close]) {
		control.style.cssText = "pointer-events:auto;padding:2px 8px;border:1px solid #666;border-radius:4px;cursor:pointer";
	}
	clear.style.marginLeft = "auto";
	clear.addEventListener("touchend", (e) => { e.preventDefault(); if (list) list.textContent = ""; });
	clear.addEventListener("click", () => { if (list) list.textContent = ""; });
	close.addEventListener("touchend", (e) => { e.preventDefault(); toggle(false); });
	close.addEventListener("click", () => toggle(false));
	bar.append(clear, close);
	list = document.createElement("ol");
	list.style.cssText = "margin:0;padding:4px 6px;list-style:none;overflow:auto;white-space:pre-wrap;word-break:break-all";
	panel.append(bar, list);
	document.body.appendChild(panel);
	const touchOnly = matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
	log(`diagnostics on · ${navigator.userAgent.match(/OS [\d_]+/)?.[0] ?? ""} · touch-only=${touchOnly} · ${innerWidth}x${innerHeight}`);
}

function hide(): void {
	panel?.remove();
	panel = null;
	list = null;
}

function toggle(on: boolean): void {
	try { if (on) localStorage.setItem(STORAGE_KEY, "1"); else localStorage.removeItem(STORAGE_KEY); } catch { /* private mode */ }
	if (on) show(); else hide();
}

export function installDiagnostics(): void {
	// Corner taps toggle the overlay.
	let taps: number[] = [];
	addEventListener("touchend", (event) => {
		const touch = event.changedTouches[0];
		if (!touch || touch.clientX > 72 || touch.clientY > 72) return;
		const now = performance.now();
		taps = [...taps.filter((t) => now - t < 2000), now];
		if (taps.length >= 5) { taps = []; toggle(!panel); }
	}, { capture: true, passive: true });

	for (const type of EVENTS) {
		addEventListener(type, (event) => {
			if (!panel || (event.target instanceof Element && event.target.closest("[data-lh-diagnostics]"))) return;
			const extra = event instanceof FocusEvent ? ` → ${describe(event.relatedTarget)}`
				: type === "change" && event.target instanceof HTMLInputElement && event.target.type === "file" ? ` files=${event.target.files?.length ?? 0}`
				: "";
			const line = log(`${type.padEnd(12)} ${describe(event.target)}${extra}`);
			// Report whether the page prevented the default, once dispatch ends.
			setTimeout(() => { if (line && event.defaultPrevented) line.textContent += "  [prevented]"; }, 0);
		}, { capture: true, passive: true });
	}

	const inputClick = HTMLInputElement.prototype.click;
	HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
		if (panel) log(`INPUT.click() ${describe(this)} connected=${this.isConnected} display=${getComputedStyle(this).display}`);
		return inputClick.call(this);
	};
	addEventListener("error", (e) => { if (panel) log(`ERROR ${e.message}`); });
	addEventListener("unhandledrejection", (e) => { if (panel) log(`REJECTION ${String((e.reason as Error)?.message ?? e.reason)}`); });

	try { if (localStorage.getItem(STORAGE_KEY) === "1") show(); } catch { /* private mode */ }
}
