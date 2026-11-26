/** next/server for the iPad app. Route handlers use only standard Response;
 *  this covers the few framework helpers that might be reached. */
export const NextResponse = Response;
export const NextRequest = Request;
export async function connection(): Promise<void> {}
export function after(task: (() => unknown) | Promise<unknown>): void {
	queueMicrotask(() => { void (typeof task === "function" ? task() : task); });
}
