import type tslib from "typescript/lib/tsserverlibrary";
import { getCallSiteAtPosition, getArgumentIndex } from "./analysis.js";
import { compileCached, getCallableFunctionNames, findFunctionAbi, type SolcAbiParam, type SolcStandardOutput } from "./solc-cache.js";

/**
 * Map a Solidity type to a TypeScript type string for display.
 */
export function solidityTypeToTs(param: SolcAbiParam): string {
  const t = param.type;

  if (t === "address") return "`0x${string}`";
  if (t === "bool") return "boolean";
  if (t === "string") return "string";
  if (t === "bytes" || t.match(/^bytes\d+$/)) return "`0x${string}`";

  if (t.match(/^u?int\d*$/)) return "bigint";

  // Arrays
  if (t.endsWith("[]")) {
    const inner = { ...param, type: t.slice(0, -2) };
    return `${solidityTypeToTs(inner)}[]`;
  }

  // Fixed-size arrays
  const fixedArray = t.match(/^(.+)\[(\d+)\]$/);
  if (fixedArray) {
    const inner = { ...param, type: fixedArray[1] };
    return `${solidityTypeToTs(inner)}[]`;
  }

  // Tuples
  if (t === "tuple" && param.components) {
    const fields = param.components.map((c) => `${c.name}: ${solidityTypeToTs(c)}`).join("; ");
    return `{ ${fields} }`;
  }

  return "unknown";
}

/**
 * Format a function's return type for display.
 */
export function formatReturnType(outputs: SolcAbiParam[]): string {
  if (outputs.length === 0) return "void";
  if (outputs.length === 1) return solidityTypeToTs(outputs[0]);
  // Multiple returns → tuple
  return `[${outputs.map((o) => solidityTypeToTs(o)).join(", ")}]`;
}

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
        const fnAbi = findFunctionAbi(output!, name);
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
