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
	plugins: {
		Keyboard: {
			// Shrink the web view to the space above the on-screen keyboard
			// (instead of covering the bottom of the app), so the composer and
			// the content above it stay visible while typing.
			resize: "native",
			resizeOnFullScreen: true,
		},
	},
};

export default config;
