# LearnHarness for iPad

The LearnHarness desktop app, running entirely on the iPad: the same UI, and the same server code running inside the app instead of on a computer. Your sessions, knowledge graph, settings and API keys are stored on the iPad. Models are called straight from the iPad with your API keys.

Status: **phase 0 (proof of concept).** See [What works](#what-works).

## Install on your iPad

You need a computer with [Sideloadly](https://sideloadly.io) (Windows or Mac) and a free Apple ID.

1. On GitHub, open **Actions → iPad app**, pick the latest successful run, and download the **LearnHarness-ipa-…** artifact. Unzip it to get `LearnHarness.ipa`.
2. Connect the iPad by USB and open Sideloadly. Drag in `LearnHarness.ipa`, enter your Apple ID, and click **Start**.
3. On the iPad, open **Settings → General → VPN & Device Management**, tap your Apple ID, and choose **Trust**.
4. Turn on **Settings → Privacy & Security → Developer Mode** if iPadOS asks for it, then restart.

With a free Apple ID the app stops opening after **7 days**. Run Sideloadly again to re-sign it; your data stays on the iPad.

## How it works

| Desktop | iPad |
| --- | --- |
| Next.js server process | The same route handlers (`app/api/**/route.ts`), called in-process: `fetch("/api/…")` and `EventSource` are routed to them without a network ([`src/runtime/api.ts`](src/runtime/api.ts)) |
| Pages as server components | [`src/app/pages.tsx`](src/app/pages.tsx): the same five pages, reading the in-app server directly |
| Files under the data folder | An in-memory file system (memfs) with the data root (`/data`) saved to IndexedDB ([`src/runtime/persistence.ts`](src/runtime/persistence.ts)) |
| Node built-ins | Browser stand-ins under [`src/shims/node/`](src/shims/node/) |
| Electron | A Capacitor iOS shell ([`ios/`](ios/)) |

Nothing outside `ipad/` changes to make this work. The desktop code is bundled unchanged, so updates from upstream LearnHarness come along with a normal merge.

## What works

- The full UI, sized for iPad.
- Settings, providers and models; teaching and practice sessions with streamed replies; saved sessions that survive restarts.
- Model calls straight from the iPad. Verified end to end with a custom OpenAI-compatible endpoint. Providers whose APIs accept browser requests (Anthropic, OpenAI, OpenRouter, Google) should work the same way but haven't been tested with real keys yet. A provider that blocks browser requests (CORS) will need the native-networking path from phase 1.

Not yet (phase 1 and later):

- **Visuals, PDF figures and demo checks:** they need native Node add-ons (resvg, Skia canvas) or headless Chrome. They fail with a clear "not available on iPad" error until WebAssembly/WebKit versions replace them.
- **Background workers** (image resizing) and **plugins** whose backends load Node modules.
- **Research web fetches** of arbitrary pages are blocked by web-view CORS rules. Phase 1 moves them to native iOS networking. It also restores the desktop's check of the address each connection actually reaches; today only private/local IP literals and local host names are refused.
- **Attaching files** (the desktop sends file paths) needs the Files picker.
- **Claude Code CLI and subscription logins** need the laptop bridge (phase 2).
- Learning data lives in IndexedDB. Phase 1 moves it to files in the app's Documents folder, visible in the Files app and included in backups.

## Develop

From the repo root, after the normal `npm ci && npm run plugins:setup`:

```sh
cd ipad
npm ci
npm run dev          # http://localhost:5173 in any browser
npm run build        # web bundle in dist/
npm run typecheck
npm run preview      # serve dist/ on :4173
npm run smoke        # load dist/ in headless Chrome, print errors and page text
node scripts/fake-model.mjs &   # OpenAI-compatible fake model on :8787
npm run e2e          # one full teaching turn against the fake model, then reload
npx cap sync ios     # copy dist/ into the Xcode project
```

`LH_IPAD_MINIFY=1` and `LH_IPAD_SOURCEMAP=1` control the build. On a device, Safari's **Develop** menu (on a Mac) can inspect the running app.

The `.ipa` is built by [`.github/workflows/ipad.yml`](../.github/workflows/ipad.yml) on a GitHub macOS runner, so no Mac is needed.
