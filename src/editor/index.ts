import * as fs from "fs";
import * as path from "path";

import type tslib from "typescript/lib/tsserverlibrary";

import { createGetSemanticDiagnostics } from "./diagnostics.js";
import { getTypesFilePath, regenerateTypesFile } from "./typegen.js";

function init(modules: { typescript: typeof tslib }) {
  const ts = modules.typescript;

  let pluginInfo: tslib.server.PluginCreateInfo;
  let projectDirectory: string;

  function create(info: tslib.server.PluginCreateInfo) {
    info.project.projectService.logger.info("soltag plugin loaded");

    pluginInfo = info;
    projectDirectory = path.dirname(info.project.getProjectName());

    // Create proxy that delegates to the original language service
    const proxy = Object.create(null) as tslib.LanguageService;
    for (const k of Object.keys(info.languageService) as (keyof tslib.LanguageService)[]) {
      const x = info.languageService[k]!;
      // biome-ignore lint/complexity/noBannedTypes: dynamic proxy for the LS API
      proxy[k] = (...args: unknown[]) => (x as Function).apply(info.languageService, args);
    }

    proxy.getSemanticDiagnostics = createGetSemanticDiagnostics(ts, info);

    return proxy;
  }

  function getExternalFiles(_project: tslib.server.Project, _updateLevel: tslib.ProgramUpdateLevel): string[] {
    if (!pluginInfo) return [];

    regenerateTypesFile(ts, pluginInfo, projectDirectory);

    const typesFile = getTypesFilePath(projectDirectory);
    return fs.existsSync(typesFile) ? [typesFile] : [];
  }

  return { create, getExternalFiles };
}

// @ts-expect-error TS1203: export = is required for tsserver plugins (CJS), but our tsconfig targets ESM. tsup handles the actual build.
export = init;
