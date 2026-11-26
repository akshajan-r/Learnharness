/**
 * No surprise keyboards on touch-only iPads.
 *
 * The desktop UI focuses text fields on its own (the home composer on
 * launch, composers after navigation, editors as they mount) so a keyboard
 * user can type at once. On an iPad without a trackpad or keyboard, every
 * such focus raises the on-screen keyboard over half the screen.
 *
 * Rule: on touch-only devices, focusing a text-entry element is allowed
 * only shortly after the learner tapped or pressed a key; automatic focus
 * with no recent interaction (app launch, a turn finishing, a background
 * refresh) is skipped. Tapping a field focuses it natively and is never
 * affected. With a trackpad, mouse or hardware keyboard attached, nothing
 * changes.
 *
 * React's autoFocus calls element.focus() after mount, so wrapping
 * HTMLElement.prototype.focus covers it along with direct focus() calls.
 */
import { touchOnlyDevice } from "@/components/on-screen-keyboard";

/** How long after a tap or key press a programmatic focus still counts as
 *  the learner's own action (navigation and mounting take a few frames). */
const INTENT_WINDOW_MS = 1000;

let lastIntentAt = Number.NEGATIVE_INFINITY;

const TEXT_INPUT_TYPES = new Set(["", "text", "search", "email", "url", "tel", "password", "number", "date", "datetime-local", "month", "time", "week"]);

function raisesKeyboard(el: Element): boolean {
	if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
	if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type) && !el.readOnly && !el.disabled;
	return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * Chromium focus semantics for buttons.
 *
 * The UI is built on Chromium (Electron), where pressing a button focuses
 * it, so focus moves INTO the pressed control. WebKit (iPad, Safari) never
 * focuses a button on press: the press clears focus instead, and the
 * previously focused element blurs with relatedTarget = null. Popups that
 * close when focus leaves them (the attach and extract-files menus) then
 * close on the very press meant for one of their items, before its click
 * arrives, so nothing happens.
 *
 * Here a press on a button-like control is handled as Chromium does: its
 * default action (WebKit's focus clearing) is prevented and the control is
 * focused, so focus moves to it and blur handlers see where it went. The
 * click itself is unaffected.
 */
const PRESSABLE = 'button, [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="tab"], summary';

function installButtonFocusParity(): void {
	addEventListener("mousedown", (event) => {
		if (event.button !== 0 || !(event.target instanceof Element)) return;
		const control = event.target.closest<HTMLElement>(PRESSABLE);
		if (!control || control.matches(":disabled, [aria-disabled='true']") || control.isContentEditable) return;
		event.preventDefault();
		if (document.activeElement !== control) control.focus({ preventScroll: true });
	}, { capture: true });
}

export function installTouchFocusPolicy(): void {
	const markIntent = () => { lastIntentAt = performance.now(); };
	// Capture phase: recorded before any handler that might focus a field.
	for (const type of ["pointerdown", "touchend", "click", "keydown"] as const) {
		addEventListener(type, markIntent, { capture: true, passive: true });
	}

	installButtonFocusParity();

	const blocked = () => touchOnlyDevice() && performance.now() - lastIntentAt > INTENT_WINDOW_MS;

	const focus = HTMLElement.prototype.focus;
	HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
		if (raisesKeyboard(this) && blocked()) return;
		return focus.call(this, options);
	};

	// Placing the caret inside an unfocused contenteditable (the composer
	// restores its saved cursor this way) also focuses it. Skip those
	// placements under the same rule; inside an already-focused editor the
	// caret moves normally.
	const pullsFocus = (node: Node | null | undefined): boolean => {
		const el = node instanceof Element ? node : node?.parentElement;
		const editable = el?.closest<HTMLElement>("[contenteditable]:not([contenteditable='false'])");
		return !!editable && editable.isContentEditable && !editable.contains(document.activeElement) && blocked();
	};
	const proto = Selection.prototype;
	const setBaseAndExtent = proto.setBaseAndExtent;
	proto.setBaseAndExtent = function (this: Selection, anchorNode: Node, anchorOffset: number, focusNode: Node, focusOffset: number) {
		if (pullsFocus(anchorNode)) return;
		return setBaseAndExtent.call(this, anchorNode, anchorOffset, focusNode, focusOffset);
	};
	const collapse = proto.collapse;
	proto.collapse = function (this: Selection, node: Node | null, offset?: number) {
		if (pullsFocus(node)) return;
		return collapse.call(this, node, offset);
	};
	const addRange = proto.addRange;
	proto.addRange = function (this: Selection, range: Range) {
		if (pullsFocus(range.startContainer)) return;
		return addRange.call(this, range);
	};
	const selectAllChildren = proto.selectAllChildren;
	proto.selectAllChildren = function (this: Selection, node: Node) {
		if (pullsFocus(node)) return;
		return selectAllChildren.call(this, node);
	};
}
