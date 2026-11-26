/**
 * src/agent/claude-code/installation.ts on iPad: the Claude Code CLI lives
 * on the laptop, so its installation status is the laptop bridge's.
 * Unpaired or unreachable reads as "not-found" (the CLI isn't available to
 * this app); the reason is logged.
 */
import { CLAUDE_CODE_MINIMUM_VERSION, type ClaudeCodeStatus } from "@/src/core/contracts/claude-code.ts";
import { bridgeStatus } from "../runtime/bridge.ts";

export type ReadClaudeVersion = (binary: string) => Promise<string>;

export const readClaudeVersion: ReadClaudeVersion = () => Promise.reject(new Error("The Claude Code CLI runs on the laptop bridge"));

export async function inspectClaudeInstallation(): Promise<ClaudeCodeStatus> {
	try {
		return (await bridgeStatus()).claudeCode as ClaudeCodeStatus;
	} catch (error) {
		console.warn("[bridge] Claude Code status unavailable:", (error as Error).message);
		return { state: "not-found", version: null, minimumVersion: CLAUDE_CODE_MINIMUM_VERSION } as ClaudeCodeStatus;
	}
}
