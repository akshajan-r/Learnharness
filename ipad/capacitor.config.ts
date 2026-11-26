import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
	appId: "com.akshajan.learnharness",
	appName: "LearnHarness",
	webDir: "dist",
	ios: {
		// The app draws its own chrome edge to edge.
		contentInset: "never",
		// Long lessons scroll inside the app's panes, not the web view itself.
		scrollEnabled: false,
		// Safari Web Inspector can attach to sideloaded builds (debugging on device).
		webContentsDebuggingEnabled: true,
	},
};

export default config;
