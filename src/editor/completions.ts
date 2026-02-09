import type tslib from "typescript/lib/tsserverlibrary";

import { formatReturnType } from "../codegen.js";

import { getArgumentIndex, getCallSiteAtPosition } from "./analysis.js";
import { compileCached, findFunctionAbi, getCallableFunctionNames, type SolcStandardOutput } from "./solc-cache.js";

export function createGetCompletionsAtPosition(
  ts: typeof tslib,
  info: tslib.server.PluginCreateInfo,
): tslib.LanguageService["getCompletionsAtPosition"] {
  return (fileName, position, options, formattingSettings) => {
    // Always get the default completions first
    const prior = info.languageService.getCompletionsAtPosition(fileName, position, options, formattingSettings);

    const program = info.languageService.getProgram();
    if (!program) return prior;

    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) return prior;

    const callSite = getCallSiteAtPosition(ts, sourceFile, position);
    if (!callSite) return prior;

    const argIndex = getArgumentIndex(callSite.callExpression, position, sourceFile);

    // Argument index 1 = functionName
    if (argIndex === 1) {
      let output: SolcStandardOutput;
      try {
        output = compileCached(callSite.soliditySource);
      } catch {
        return prior;
      }

      const functionNames = getCallableFunctionNames(output);

      const entries: tslib.CompletionEntry[] = functionNames.map((name) => {
        const fnAbi = findFunctionAbi(output, name);
        const returnType = fnAbi?.outputs ? formatReturnType(fnAbi.outputs) : "unknown";
        const params = fnAbi?.inputs?.map((p) => `${p.name || "_"}: ${p.type}`).join(", ");

        return {
          name,
          kind: ts.ScriptElementKind.memberFunctionElement,
          sortText: "0",
          labelDetails: {
            description: `(${params || ""}) → ${returnType}`,
          },
        };
      });

      return {
        isGlobalCompletion: false,
        isMemberCompletion: false,
        isNewIdentifierLocation: false,
        entries,
      };
    }

    return prior;
  };
}
