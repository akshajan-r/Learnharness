/**
 * The desktop app's pages (app/page.tsx, app/chat/…, …). Desktop renders
 * them as server components; here the server runs in the same process, so
 * each page reads the same server functions synchronously during render and
 * re-reads them whenever the location changes or router.refresh() runs.
 */
import { Component, type ReactNode } from "react";
import { Home } from "@/components/home";
import { NewSession } from "@/components/new-session";
import { Chat } from "@/components/chat";
import { PluginViewScreen } from "@/components/plugin-view";
import { resolveSettings, slotsConfigured } from "@/src/core";
import { compactionInFlight, getChat, isTurnRunning, readSettingsRecord, turnFailure } from "@/src/server";
import { NavigationSignal } from "../shims/next/navigation.ts";
import { navigate, type Location } from "./location.ts";

function HomePage() {
	const record = readSettingsRecord();
	const rendering = resolveSettings(record ?? null).graph.rendering;
	return <Home initialConfigured={slotsConfigured(record?.models)} rendering={rendering} />;
}

function NewSessionPage({ search }: { search: URLSearchParams }) {
	return (
		<NewSession
			initialConfigured={slotsConfigured(readSettingsRecord()?.models)}
			mode={search.get("mode") === "practice" ? "practice" : "teach"}
		/>
	);
}

function ChatPage({ id, search }: { id: string; search: URLSearchParams }) {
	const chat = getChat(id);
	if (!chat) return <NotFound />;
	const record = readSettingsRecord();
	return (
		<Chat
			key={chat.id}
			chatId={chat.id}
			title={chat.title}
			kind={chat.kind ?? "teach"}
			initialMessages={chat.messages}
			initialError={turnFailure(chat.id)}
			initialConfigured={slotsConfigured(record?.models)}
			initialPrompt={search.get("prompt") ?? undefined}
			initiallyInFlight={isTurnRunning(chat.id)}
			initiallyCompacting={compactionInFlight(chat.id)}
		/>
	);
}

function NotFound() {
	return (
		<div className="px-5 py-4 text-sm text-muted-foreground">
			<p>This page doesn't exist.</p>
			<a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }} className="mt-3 inline-block underline">Back to home</a>
		</div>
	);
}

export function Page({ location }: { location: Location }) {
	const { pathname } = location;
	const search = new URLSearchParams(location.search);
	if (pathname === "/" || pathname === "/index.html") return <HomePage />;
	if (pathname === "/chat/new") return <NewSessionPage search={search} />;
	// The settings page redirects on desktop (settings is a dialog).
	if (pathname === "/settings") { queueMicrotask(() => navigate("/chat/new", { replace: true })); return null; }
	const chat = pathname.match(/^\/chat\/([^/]+)\/?$/);
	if (chat) return <ChatPage id={decodeURIComponent(chat[1]!)} search={search} />;
	const plugin = pathname.match(/^\/plugins\/([^/]+)\/([^/]+)\/?$/);
	if (plugin) return <PluginViewScreen pluginId={decodeURIComponent(plugin[1]!)} viewId={decodeURIComponent(plugin[2]!)} />;
	return <NotFound />;
}

/** notFound()/redirect() thrown inside a page, like Next's boundaries. */
export class PageBoundary extends Component<{ children: ReactNode; resetKey: string }, { signal: NavigationSignal | null; error: Error | null }> {
	state = { signal: null as NavigationSignal | null, error: null as Error | null };
	static getDerivedStateFromError(error: unknown) {
		return error instanceof NavigationSignal ? { signal: error, error: null } : { signal: null, error: error as Error };
	}
	componentDidUpdate(prev: { resetKey: string }) {
		if (prev.resetKey !== this.props.resetKey && (this.state.signal || this.state.error)) this.setState({ signal: null, error: null });
		if (this.state.signal?.kind === "redirect" && this.state.signal.href) navigate(this.state.signal.href, { replace: true });
	}
	render() {
		if (this.state.signal?.kind === "not-found") return <NotFound />;
		if (this.state.error) {
			return (
				<div className="px-5 py-4 text-sm">
					<p className="font-medium">Something went wrong on this page.</p>
					<pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{this.state.error.stack ?? this.state.error.message}</pre>
				</div>
			);
		}
		return this.props.children;
	}
}
