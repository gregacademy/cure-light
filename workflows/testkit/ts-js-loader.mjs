// workflows/testkit/ts-js-loader.mjs — resolve NodeNext-style `.js` specifiers to
// sibling TypeScript sources for the opt-in compile tier.
//
// pi-schematic's workflow compiler is TypeScript and imports `./types.js` while the
// checkout ships `types.ts`. Node runs `.ts` files natively but does not map `.js` to
// `.ts`, and the checkout's own test loader also needs the pi packages installed. This
// hook is deliberately narrow: it rewrites only relative `.js` imports whose `.ts`
// sibling exists, so a normal `.js` import keeps its meaning. Register it (side-effect
// import) before dynamically importing `workflow/compile.ts`.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js") && context.parentURL) {
      const parentPath = fileURLToPath(context.parentURL);
      const tsPath = path.resolve(path.dirname(parentPath), specifier.slice(0, -3) + ".ts");
      if (existsSync(tsPath)) return nextResolve(pathToFileURL(tsPath).href, context);
    }
    return nextResolve(specifier, context);
  },
});
