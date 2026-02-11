import type tslib from "typescript/lib/tsserverlibrary";

import { resolveStringExpression } from "../ast-utils.js";
import { compileCached, type SolcStandardOutput } from "../solc.js";

import { findSolTemplateLiterals } from "./analysis.js";
import { isDuplicateContractName } from "./typegen.js";

/**
 * Map a position in the compiled Solidity source back to the corresponding
 * position in the editor's template literal, accounting for interpolations
 * whose resolved text may be longer or shorter than the `${expr}` syntax.
 */
function mapCompiledPosToEditor(
  ts: typeof tslib,
  template: tslib.TemplateLiteral,
  sourceFile: tslib.SourceFile,
  compiledPos: number,
  side: "start" | "end",
): number {
  // No interpolations — compiled source is a 1:1 match with the template text
  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    return template.getStart(sourceFile) + 1 + compiledPos; // +1 for backtick
  }

  // TemplateExpression: walk head + spans, tracking compiled offset
  const expr = template as tslib.TemplateExpression;
  let compiledOffset = 0;

  // Head text region (1:1 with editor)
  const headLen = expr.head.text.length;
  if (compiledPos < compiledOffset + headLen) {
    return expr.head.getStart(sourceFile) + 1 + (compiledPos - compiledOffset);
  }
  compiledOffset += headLen;

  for (const span of expr.templateSpans) {
    // Resolved expression region — map to the expression node in the editor
    const resolved = resolveStringExpression(ts, span.expression, sourceFile);
    const resolvedLen = resolved?.length ?? 0;
    if (compiledPos < compiledOffset + resolvedLen) {
      return side === "start" ? span.expression.getStart(sourceFile) : span.expression.getEnd();
    }
    compiledOffset += resolvedLen;

    // Literal text region after expression (1:1 with editor)
    const litLen = span.literal.text.length;
    if (compiledPos < compiledOffset + litLen) {
      return span.literal.getStart(sourceFile) + 1 + (compiledPos - compiledOffset);
    }
    compiledOffset += litLen;
  }

  // Past the end — return end of template
  return template.getEnd() - 1;
}

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
          const templateNode = literal.node.template;
          start = mapCompiledPosToEditor(ts, templateNode, sourceFile, error.sourceLocation.start, "start");
          const end = mapCompiledPosToEditor(ts, templateNode, sourceFile, error.sourceLocation.end, "end");
          length = Math.max(end - start, 1);
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
