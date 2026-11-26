/** app/layout.tsx for the iPad app: the same provider stack and shell. */
import { AppShell, SidebarProvider } from "@/components/sidebar";
import { ActivityProvider } from "@/components/activity-dock";
import { ServerEventsProvider } from "@/components/server-events";
import { AppearanceProvider } from "@/components/settings/appearance";
import { PluginsProvider } from "@/components/plugins";
import type { ThemeBoot } from "@/src/server";
import { useLocation } from "./location.ts";
import { Page, PageBoundary } from "./pages.tsx";

export function App({ boot }: { boot: ThemeBoot }) {
	const location = useLocation();
	const key = location.pathname + location.search;
	return (
		<ServerEventsProvider>
			<PluginsProvider>
				<AppearanceProvider initialAppearance={boot.appearance} initialTheme={boot.theme}>
					<SidebarProvider>
						<ActivityProvider>
							<AppShell>
								<PageBoundary resetKey={key}>
									<Page location={location} />
								</PageBoundary>
							</AppShell>
						</ActivityProvider>
					</SidebarProvider>
				</AppearanceProvider>
			</PluginsProvider>
		</ServerEventsProvider>
	);
}
