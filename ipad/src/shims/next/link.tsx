/** next/link for the iPad app: a plain anchor that navigates in-app. */
import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { navigate } from "../../app/location.ts";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
	href: string | { pathname?: string; query?: Record<string, string> };
	replace?: boolean;
	prefetch?: boolean;
	scroll?: boolean;
};

function hrefOf(href: LinkProps["href"]): string {
	if (typeof href === "string") return href;
	const query = href.query ? `?${new URLSearchParams(href.query)}` : "";
	return `${href.pathname ?? ""}${query}`;
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ href, replace, prefetch: _prefetch, scroll: _scroll, onClick, ...rest }, ref) {
	const target = hrefOf(href);
	const handle = (event: MouseEvent<HTMLAnchorElement>) => {
		onClick?.(event);
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		if (rest.target && rest.target !== "_self") return;
		const url = new URL(target, window.location.href);
		if (url.origin !== window.location.origin) return;
		event.preventDefault();
		navigate(target, { replace });
	};
	return <a ref={ref} href={target} onClick={handle} {...rest} />;
});

export default Link;
