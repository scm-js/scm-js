/**
 * Lets a plain Node script import the editor's TypeScript modules.
 *
 * Node strips the types itself (the project's `erasableSyntaxOnly` is what makes that
 * safe), but it resolves the way the browser does: `import "../i18n"` has no extension
 * and `import ko from "./ko.json"` has no `with { type: "json" }`, both of which Vite
 * accepts and Node refuses. These two hooks close exactly that gap. Import this module
 * before the first dynamic `import()` of a `.ts` file.
 */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, next) {
    const relative = specifier.startsWith(".") || specifier.startsWith("/");
    if (relative && !/\.(?:[cm]?[jt]s|json)$/.test(specifier)) {
      for (const suffix of [".ts", "/index.ts"]) {
        const url = new URL(specifier + suffix, context.parentURL);
        if (existsSync(fileURLToPath(url))) return next(url.href, context);
      }
    }
    if (specifier.endsWith(".json")) return { ...next(specifier, context), importAttributes: { type: "json" } };
    return next(specifier, context);
  },
});
