import type tslib from "typescript/lib/tsserverlibrary";

import { createGetCompletionsAtPosition } from "./completions.js";
import { createGetSemanticDiagnostics } from "./diagnostics.js";
import { createGetQuickInfoAtPosition } from "./quickinfo.js";

function init(modules: { typescript: typeof tslib }) {
  const ts = modules.typescript;

  function create(info: tslib.server.PluginCreateInfo) {
    info.project.projectService.logger.info("soltag plugin loaded");

    // Create proxy that delegates to the original language service
    const proxy = Object.create(null) as tslib.LanguageService;
    for (const k of Object.keys(info.languageService) as (keyof tslib.LanguageService)[]) {
      const x = info.languageService[k]!;
      // biome-ignore lint/complexity/noBannedTypes: dynamic proxy for the LS API
      proxy[k] = (...args: unknown[]) => (x as Function).apply(info.languageService, args);
    }

    proxy.getCompletionsAtPosition = createGetCompletionsAtPosition(ts, info);
    proxy.getSemanticDiagnostics = createGetSemanticDiagnostics(ts, info);
    proxy.getQuickInfoAtPosition = createGetQuickInfoAtPosition(ts, info);

    return proxy;
  }

  return { create };
}

// @ts-expect-error TS1203: export = is required for tsserver plugins (CJS), but our tsconfig targets ESM. tsup handles the actual build.
export = init;
