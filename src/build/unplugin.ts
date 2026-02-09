import { createUnplugin } from "unplugin";
import MagicString from "magic-string";
import ts from "typescript";
import { compile, hashSource } from "../runtime/compiler.js";

export interface TsSolPluginOptions {
  /** Extra file extensions to include. Defaults to ['.ts', '.tsx', '.mts', '.cts'] */
  include?: string[];
  /** Patterns to exclude. Defaults to [/node_modules/] */
  exclude?: RegExp[];
}

/**
 * Try to resolve a TS expression to a string constant at build time.
 * Returns the resolved string, or undefined if the expression can't be statically resolved.
 */
function resolveStringExpression(node: ts.Expression, sourceFile: ts.SourceFile): string | undefined {
  if (ts.isStringLiteral(node)) return node.text;

  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;

  if (ts.isTemplateExpression(node)) {
    let result = node.head.text;
    for (const span of node.templateSpans) {
      const resolved = resolveStringExpression(span.expression, sourceFile);
      if (resolved === undefined) return undefined;
      result += resolved + span.literal.text;
    }
    return result;
  }

  if (ts.isIdentifier(node)) {
    return resolveIdentifierToString(node, sourceFile);
  }

  // String concatenation with +
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveStringExpression(node.left, sourceFile);
    const right = resolveStringExpression(node.right, sourceFile);
    if (left !== undefined && right !== undefined) return left + right;
    return undefined;
  }

  return undefined;
}

/**
 * Find a const declaration for an identifier and resolve its string value.
 */
function resolveIdentifierToString(identifier: ts.Identifier, sourceFile: ts.SourceFile): string | undefined {
  const name = identifier.text;

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;

    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
        return resolveStringExpression(decl.initializer, sourceFile);
      }
    }
  }

  return undefined;
}

/**
 * Extract the full Solidity source from a tagged template, resolving interpolations.
 * Returns undefined if any interpolation can't be statically resolved.
 */
function extractTemplateSource(template: ts.TemplateLiteral, sourceFile: ts.SourceFile): string | undefined {
  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    return template.text;
  }

  let result = template.head.text;
  for (const span of template.templateSpans) {
    const resolved = resolveStringExpression(span.expression, sourceFile);
    if (resolved === undefined) return undefined;
    result += resolved + span.literal.text;
  }
  return result;
}

/**
 * Core transform logic, exported for testing.
 */
export function transformSolTemplates(
  code: string,
  id: string,
): { code: string; map: ReturnType<MagicString["generateMap"]> } | undefined {
  if (!code.includes("sol`") && !code.includes("sol `")) return undefined;

  const sourceFile = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
  const s = new MagicString(code);
  let hasReplacements = false;

  function visit(node: ts.Node) {
    if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === "sol") {
      const soliditySource = extractTemplateSource(node.template, sourceFile);
      if (soliditySource === undefined) {
        // Can't resolve at build time — leave for runtime
        return;
      }

      const artifacts = compile(soliditySource);
      const sourceHash = hashSource(soliditySource);

      const replacement = `__SolContract.fromArtifacts(${JSON.stringify(artifacts)}, "${sourceHash}")`;
      s.overwrite(node.getStart(sourceFile), node.getEnd(), replacement);
      hasReplacements = true;
      return; // Don't visit children
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (!hasReplacements) return undefined;

  s.prepend('import { SolContract as __SolContract } from "soltag";\n');

  return {
    code: s.toString(),
    map: s.generateMap({ source: id, hires: true }),
  };
}

export const unplugin = createUnplugin((options?: TsSolPluginOptions) => {
  const include = options?.include ?? [".ts", ".tsx", ".mts", ".cts"];
  const exclude = options?.exclude ?? [/node_modules/];

  return {
    name: "soltag",
    enforce: "pre" as const,

    transformInclude(id: string) {
      if (exclude.some((e) => e.test(id))) return false;
      return include.some((ext) => id.endsWith(ext));
    },

    transform(code: string, id: string) {
      return transformSolTemplates(code, id);
    },
  };
});

export default unplugin;
