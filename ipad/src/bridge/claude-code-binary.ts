/**
 * src/agent/claude-code/binary.ts on iPad: there is no local `claude`
 * executable; the CLI is "present" when a laptop bridge is paired. This
 * gates whether Claude Code models are offered (claudeCodeAvailable); the
 * real version check goes through the bridge (claude-code-installation.ts).
 */
import { bridgeConfig } from "../runtime/bridge.ts";

export const BRIDGE_BINARY = "claude (laptop bridge)";

export function resolveClaudeBinary(): string | null {
	return null;
}

export function getClaudeBinary(): string | null {
	return bridgeConfig() ? BRIDGE_BINARY : null;
}
