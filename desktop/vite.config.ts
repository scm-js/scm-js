import { defineConfig } from "vite";

/**
 * Bundles the desktop main process and its preload into `desktop/dist/` as CommonJS for
 * Electron. Everything but `electron` and Node's own modules is bundled (mopaq, the shared
 * extraction), so the packaged app carries no node_modules. `npm run build:desktop` runs
 * this after the ordinary web build.
 */
export default defineConfig({
  // public/ is the web build's; copying it here would drag a developer's game data along.
  publicDir: false,
  build: {
    ssr: true,
    outDir: "desktop/dist",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    sourcemap: false,
    lib: {
      entry: { main: "desktop/main.ts", preload: "desktop/preload.ts" },
      formats: ["cjs"],
      fileName: (_format, name) => `${name}.cjs`,
    },
    rollupOptions: {
      external: ["electron"],
      output: { inlineDynamicImports: false },
    },
  },
  ssr: { noExternal: true },
});
