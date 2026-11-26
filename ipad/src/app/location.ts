/**
 * The app's location — a minimal stand-in for Next's App Router state.
 * Paths are the desktop app's URLs (/, /chat/new, /chat/:id, …) kept in
 * history.pushState, so components navigate exactly as they do on desktop.
 */
import { useSyncExternalStore } from "react";

export type Location = { pathname: string; search: string; version: number };

let current: Location = { pathname: window.location.pathname, search: window.location.search, version: 0 };
const listeners = new Set<() => void>();

function publish(next: Partial<Location>): void {
	current = { ...current, ...next };
	for (const listener of listeners) listener();
}

addEventListener("popstate", () => publish({ pathname: window.location.pathname, search: window.location.search }));

export function navigate(href: string, { replace = false }: { replace?: boolean } = {}): void {
	const url = new URL(href, window.location.href);
	if (url.origin !== window.location.origin) { window.location.href = url.href; return; }
	if (replace) history.replaceState(null, "", url.pathname + url.search + url.hash);
	else history.pushState(null, "", url.pathname + url.search + url.hash);
	publish({ pathname: url.pathname, search: url.search, version: current.version + 1 });
	if (!url.hash) window.scrollTo(0, 0);
}

/** Next's router.refresh(): re-read server state without remounting. */
export function refresh(): void {
	publish({ version: current.version + 1 });
}

export function useLocation(): Location {
	return useSyncExternalStore(
		(cb) => { listeners.add(cb); return () => listeners.delete(cb); },
		() => current,
	);
}
