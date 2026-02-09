import type tslib from "typescript/lib/tsserverlibrary";

import { formatReturnType, solidityTypeToTs } from "../codegen.js";

import { findSolTemplateLiterals, getCallSiteAtPosition } from "./analysis.js";
import {
  compileCached,
  extractAllAbis,
  findFunctionAbi,
  type SolcAbiParam,
  type SolcStandardOutput,
} from "./solc-cache.js";

function formatParamTs(param: SolcAbiParam): string {
  return `${param.name || "_"}: ${solidityTypeToTs(param)}`;
}

export function createGetQuickInfoAtPosition(
  ts: typeof tslib,
  info: tslib.server.PluginCreateInfo,
): tslib.LanguageService["getQuickInfoAtPosition"] {
  return (fileName, position) => {
    const prior = info.languageService.getQuickInfoAtPosition(fileName, position);

    const program = info.languageService.getProgram();
    if (!program) return prior;

    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) return prior;

    // Check if hovering over a function name in .call()
    const callSite = getCallSiteAtPosition(ts, sourceFile, position);
    if (callSite?.functionName && callSite.functionNameNode) {
      const fnStart = callSite.functionNameNode.getStart(sourceFile);
      const fnEnd = callSite.functionNameNode.getEnd();

      if (position >= fnStart && position <= fnEnd) {
        let output: SolcStandardOutput;
        try {
          output = compileCached(callSite.soliditySource);
        } catch {
          return prior;
        }

        const fnAbi = findFunctionAbi(output, callSite.functionName);
        if (fnAbi) {
          const params = (fnAbi.inputs ?? []).map(formatParamTs).join(", ");
          const returns = formatReturnType(fnAbi.outputs ?? []);
          const solParams = (fnAbi.inputs ?? []).map((p) => `${p.type}${p.name ? ` ${p.name}` : ""}`).join(", ");
          const solReturns = (fnAbi.outputs ?? []).map((p) => p.type).join(", ");

          const displayParts: tslib.SymbolDisplayPart[] = [
            { text: `function ${callSite.functionName}`, kind: "text" },
            { text: `(${params})`, kind: "text" },
            { text: `: Promise<${returns}>`, kind: "text" },
          ];

          const documentation: tslib.SymbolDisplayPart[] = [
            {
              text: `Solidity: ${fnAbi.name}(${solParams}) returns (${solReturns})`,
              kind: "text",
            },
            {
              text: `\nMutability: ${fnAbi.stateMutability ?? "nonpayable"}`,
              kind: "text",
            },
          ];

          return {
            kind: ts.ScriptElementKind.memberFunctionElement,
            kindModifiers: "",
            textSpan: {
              start: fnStart,
              length: fnEnd - fnStart,
            },
            displayParts,
            documentation,
          };
        }
      }
    }

    // Check if hovering over the `sol` tag itself
    const solLiterals = findSolTemplateLiterals(ts, sourceFile);
    for (const literal of solLiterals) {
      const tag = literal.node.tag;
      const tagStart = tag.getStart(sourceFile);
      const tagEnd = tag.getEnd();

      if (position >= tagStart && position <= tagEnd) {
        if (literal.source === undefined) return prior;

        let output: SolcStandardOutput;
        try {
          output = compileCached(literal.source);
        } catch {
          return prior;
        }

        const contractNames = output.contracts ? Object.values(output.contracts).flatMap((f) => Object.keys(f)) : [];
        const abis = extractAllAbis(output);
        const fnCount = abis.filter((a) => a.type === "function").length;

        const displayParts: tslib.SymbolDisplayPart[] = [
          { text: "sol", kind: "text" },
          {
            text: ` — ${contractNames.length} contract(s), ${fnCount} function(s)`,
            kind: "text",
          },
        ];

        const documentation: tslib.SymbolDisplayPart[] = [];
        if (contractNames.length > 0) {
          documentation.push({
            text: `Contracts: ${contractNames.join(", ")}`,
            kind: "text",
          });
        }

        return {
          kind: ts.ScriptElementKind.constElement,
          kindModifiers: "",
          textSpan: { start: tagStart, length: tagEnd - tagStart },
          displayParts,
          documentation,
        };
      }
    }

    return prior;
  };
}
