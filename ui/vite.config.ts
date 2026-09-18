import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Build the Warmup Companion to ONE self-contained HTML (Path B). A single input +
// `inlineDynamicImports` is the locked recipe for `vite-plugin-singlefile`: it
// inlines ALL JS + CSS (incl. the Tailwind-compiled utilities the @ryu/ui
// components use) into the HTML so the emitted document has ZERO external fetches —
// required under the companion CSP `connect-src 'none'`. Tailwind is compiled at
// build time via `@tailwindcss/postcss` (see postcss.config.mjs), scanning this
// package's own src PLUS the specific @ryu/ui component files it imports (`@source`
// in tailwind.css), with a self-contained token block copied from the design
// system. The output is `dist/index.html`, shipped verbatim as the plugin's
// `ui_code`.

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root: here,
	// The document is a null-origin srcdoc; every asset must resolve inline.
	base: "./",
	plugins: [react(), viteSingleFile()],
	build: {
		outDir: "dist",
		emptyOutDir: true,
		target: "esnext",
		cssCodeSplit: false,
		assetsInlineLimit: Number.POSITIVE_INFINITY,
		modulePreload: { polyfill: false },
		rollupOptions: {
			input: { warmup: resolve(here, "index.html") },
			output: { inlineDynamicImports: true },
		},
	},
});
