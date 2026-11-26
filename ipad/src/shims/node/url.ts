import { fileURLToPath, pathToFileURL } from "./misc.ts";
export { fileURLToPath, pathToFileURL };
export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;
export default { fileURLToPath, pathToFileURL, URL: globalThis.URL, URLSearchParams: globalThis.URLSearchParams };
