/**
 * End-to-end check of one teaching turn inside the browser runtime:
 * connect the fake model as the custom endpoint, fill the model slots,
 * start a session, and wait for the streamed reply to be saved. Then reload
 * the page and confirm the session survived (IndexedDB persistence).
 *   node scripts/e2e-turn.mjs [appUrl] [fakeModelBase]
 */
import { createRequire } from "node:module";
const require = createRequire(new URL("../../package.json", import.meta.url));
const puppeteer = require("puppeteer-core");

const appUrl = process.argv[2] ?? "http://localhost:4173/";
const base = process.argv[3] ?? "http://localhost:8787/v1";
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const step = (s) => console.log(`\n== ${s}`);
try {
	const page = await browser.newPage();
	await page.setViewport({ width: 1180, height: 820 });
	page.on("pageerror", (e) => console.log("[pageerror]", e.message));
	page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text()); });
	await page.goto(appUrl, { waitUntil: "load" });
	await page.waitForFunction(() => document.body.innerText.includes("What do you want to learn") || document.body.innerText.includes("Add a provider"), { timeout: 20000 });

	const api = (path, method = "GET", body, extra = {}) => page.evaluate(async (path, method, body, extra) => {
		const res = await fetch(path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
		const text = await res.text();
		await globalThis.__lh?.flush();
		return { status: res.status, etag: res.headers.get("etag"), body: text.slice(0, 600) };
	}, path, method, body, extra);

	step("connect custom endpoint");
	const { etag } = await api("/api/custom-provider");
	console.log(await api("/api/custom-provider", "POST", { authMode: "keyless", baseUrl: base, manualModels: "fake-tutor" }, { "If-Match": etag }));
	step("fill model slots");
	const slot = { model: { provider: "custom", id: "fake-tutor" } };
	console.log(await api("/api/settings/models", "PUT", { strong: slot, cheap: slot, vision: slot }));
	step("create session");
	const created = await api("/api/chats", "POST", { title: "What is a derivative?" });
	console.log(created);
	const id = JSON.parse(created.body).id ?? JSON.parse(created.body).chat?.id;
	console.log("chat id:", id);

	step("open session and send first message");
	await page.goto(new URL(`/chat/${id}?prompt=${encodeURIComponent("What is a derivative?")}`, appUrl).href, { waitUntil: "load" });
	await page.waitForFunction(() => document.body.innerText.includes("fake tutor"), { timeout: 30000 }).catch(() => console.log("reply text not seen within 30s"));
	await new Promise((r) => setTimeout(r, 2500));
	const record = await api(`/api/chats/${id}`);
	console.log("record status", record.status, "contains reply:", record.body.includes("fake tutor") || (await page.evaluate(() => document.body.innerText.includes("fake tutor"))));
	if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });

	step("reload — data survives?");
	await page.goto(appUrl, { waitUntil: "load" });
	await page.waitForFunction(() => document.body.innerText.includes("SESSIONS"), { timeout: 20000 });
	await new Promise((r) => setTimeout(r, 1500));
	const list = await api("/api/chats");
	console.log("sessions after reload:", list.body.slice(0, 300));
} finally {
	await browser.close();
}
