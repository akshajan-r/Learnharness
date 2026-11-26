/** next/navigation for the iPad app (see src/app/location.ts). */
import { useMemo } from "react";
import { navigate, refresh, useLocation } from "../../app/location.ts";

export type AppRouter = {
	push(href: string, options?: { scroll?: boolean }): void;
	replace(href: string, options?: { scroll?: boolean }): void;
	refresh(): void;
	back(): void;
	forward(): void;
	prefetch(href: string): void;
};

const router: AppRouter = {
	push: (href) => navigate(href),
	replace: (href) => navigate(href, { replace: true }),
	refresh,
	back: () => history.back(),
	forward: () => history.forward(),
	prefetch: () => {},
};

export function useRouter(): AppRouter {
	return router;
}

export function usePathname(): string {
	return useLocation().pathname;
}

export function useSearchParams(): URLSearchParams {
	const { search } = useLocation();
	return useMemo(() => new URLSearchParams(search), [search]);
}

export function useParams(): Record<string, string> {
	return {};
}

/** Thrown by notFound()/redirect(); caught by the page boundary in pages.tsx. */
export class NavigationSignal extends Error {
	constructor(public kind: "not-found" | "redirect", public href?: string) {
		super(kind);
	}
}

export function notFound(): never {
	throw new NavigationSignal("not-found");
}

export function redirect(href: string): never {
	throw new NavigationSignal("redirect", href);
}
