/**
 * Loads the built iPad bundle in headless Chrome and reports what the page
 * shows plus any console errors. Dev check only — the real target is WebKit.
 *   node scripts/smoke.mjs [url] [waitMs]
 */
import { createRequire } from "node:module";
const require = createRequire(new URL("../../package.json", import.meta.url));
const puppeteer = require("puppeteer-core");

const url = process.argv[2] ?? "http://localhost:4173/";
const waitMs = Number(process.argv[3] ?? 4000);
const executablePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-first-run"] });
try {
	const page = await browser.newPage();
	await page.setViewport({ width: 1180, height: 820 });
	page.on("console", (m) => { if (["error", "warning"].includes(m.type())) console.log(`[console.${m.type()}]`, m.text()); });
	page.on("pageerror", (e) => console.log("[pageerror]", e.stack ?? e.message));
	await page.goto(url, { waitUntil: "load" });
	await new Promise((r) => setTimeout(r, waitMs));
	const text = await page.evaluate(() => document.body.innerText.slice(0, 1500));
	console.log("---- page text ----\n" + text);
	if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
} finally {
	await browser.close();
}
