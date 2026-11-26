/**
 * Touch-only devices (an iPad without a trackpad or mouse) show the
 * on-screen keyboard whenever a text field gains focus, covering much of the
 * screen. Menus that focus their search field on open are keyboard-first on
 * desktop; on these devices they focus the menu body instead, and the
 * learner taps the search field to type.
 */
export function touchOnlyDevice(): boolean {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
	return window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(any-pointer: fine)").matches;
}

/** Focus a search field on open, except where that would raise the
 *  on-screen keyboard. */
export function focusSearchOnOpen(input: HTMLElement | null | undefined): void {
	if (!input || touchOnlyDevice()) return;
	input.focus();
}
