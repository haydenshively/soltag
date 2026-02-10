import type tslib from "typescript/lib/tsserverlibrary";

import { findSolTemplateLiterals } from "./analysis.js";
import { compileCached, type SolcStandardOutput } from "./solc-cache.js";
import { isDuplicateContractName } from "./typegen.js";

export function createGetSemanticDiagnostics(
  ts: typeof tslib,
  info: tslib.server.PluginCreateInfo,
): tslib.LanguageService["getSemanticDiagnostics"] {
  return (fileName) => {
    const prior = info.languageService.getSemanticDiagnostics(fileName);

    const program = info.languageService.getProgram();
    if (!program) return prior;

    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) return prior;

    const solLiterals = findSolTemplateLiterals(ts, sourceFile);
    const solDiagnostics: tslib.Diagnostic[] = [];

    for (const literal of solLiterals) {
      // Warn when multiple contracts share a name but have different compiled signatures
      if (literal.source != null && isDuplicateContractName(literal.contractName)) {
        solDiagnostics.push({
          file: sourceFile,
          start: literal.pos,
          length: literal.end - literal.pos,
          messageText: `Duplicate contract name "${literal.contractName}". Multiple contracts with this name but different definitions exist in this project. Only the first definition will be used for type generation.`,
          category: ts.DiagnosticCategory.Warning,
          code: 90002,
        });
      }

      if (literal.source === undefined) continue;

      let output: SolcStandardOutput;
      try {
        output = compileCached(literal.source);
      } catch {
        // If solc itself crashes, report a generic error
        solDiagnostics.push({
          file: sourceFile,
          start: literal.pos,
          length: literal.end - literal.pos,
          messageText: "Failed to compile Solidity source",
          category: ts.DiagnosticCategory.Error,
          code: 90001,
        });
        continue;
      }

      // Check if the named contract exists in the compilation output
      const contractNames = output.contracts ? Object.values(output.contracts).flatMap((f) => Object.keys(f)) : [];
      if (!contractNames.includes(literal.contractName)) {
        const tag = literal.node.tag;
        solDiagnostics.push({
          file: sourceFile,
          start: tag.getStart(sourceFile),
          length: tag.getEnd() - tag.getStart(sourceFile),
          messageText: `Contract "${literal.contractName}" not found in Solidity source. Available contracts: ${contractNames.join(", ") || "(none)"}`,
          category: ts.DiagnosticCategory.Error,
          code: 90003,
        });
      }

      if (!output.errors) continue;

      for (const error of output.errors) {
        const category =
          error.severity === "error"
            ? ts.DiagnosticCategory.Error
            : error.severity === "warning"
              ? ts.DiagnosticCategory.Warning
              : ts.DiagnosticCategory.Suggestion;

        // Try to map source location within the template literal
        let start = literal.pos;
        let length = literal.end - literal.pos;

        if (error.sourceLocation && error.sourceLocation.file === "inline.sol") {
          // Find the template content start position
          // The template literal starts after the tag and backtick
          const templateNode = literal.node.template;
          const contentStart = templateNode.getStart(sourceFile) + 1; // +1 for backtick
          start = contentStart + error.sourceLocation.start;
          length = error.sourceLocation.end - error.sourceLocation.start;
        }

        solDiagnostics.push({
          file: sourceFile,
          start,
          length,
          messageText: error.message,
          category,
          code: 90000,
        });
      }
    }

    return [...prior, ...solDiagnostics];
  };
}
