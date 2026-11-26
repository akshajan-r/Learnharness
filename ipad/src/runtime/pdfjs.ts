/**
 * pdfjs in the web view. The server code imports the legacy build and, on
 * desktop, runs it on Node's main-thread fake worker. In a browser pdfjs
 * needs its worker script; give it the bundled one. Standard fonts are
 * served at the path standardFontsDir() computes (see vite.config.ts).
 */
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

export function installPdfjs(): void {
	GlobalWorkerOptions.workerSrc = workerSrc;
}
