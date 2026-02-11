import type typescript from "typescript";

type TS = typeof typescript;

/**
 * Check if a tag expression is a sol("Name") call expression.
 * Returns the contract name, or false if the tag is not a sol tag.
 */
export function isSolTag(ts: TS, tag: typescript.Node): { contractName: string } | false {
  if (
    ts.isCallExpression(tag) &&
    ts.isIdentifier(tag.expression) &&
    tag.expression.text === "sol" &&
    tag.arguments.length === 1 &&
    ts.isStringLiteral(tag.arguments[0])
  ) {
    return { contractName: tag.arguments[0].text };
  }
  return false;
}

/**
 * Try to resolve a TS expression to a string constant at build time.
 * Returns the resolved string, or undefined if the expression can't be statically resolved.
 */
export function resolveStringExpression(
  ts: TS,
  node: typescript.Expression,
  sourceFile: typescript.SourceFile,
): string | undefined {
  if (ts.isStringLiteral(node)) return node.text;

  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;

  if (ts.isTemplateExpression(node)) {
    let result = node.head.text;
    for (const span of node.templateSpans) {
      const resolved = resolveStringExpression(ts, span.expression, sourceFile);
      if (resolved === undefined) return undefined;
      result += resolved + span.literal.text;
    }
    return result;
  }

  if (ts.isIdentifier(node)) {
    return resolveIdentifierToString(ts, node, sourceFile);
  }

  // String concatenation with +
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveStringExpression(ts, node.left, sourceFile);
    const right = resolveStringExpression(ts, node.right, sourceFile);
    if (left !== undefined && right !== undefined) return left + right;
    return undefined;
  }

  return undefined;
}

/**
 * Find a const declaration for an identifier and resolve its string value.
 */
function resolveIdentifierToString(
  ts: TS,
  identifier: typescript.Identifier,
  sourceFile: typescript.SourceFile,
): string | undefined {
  const name = identifier.text;

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;

    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
        return resolveStringExpression(ts, decl.initializer, sourceFile);
      }
    }
  }

  return undefined;
}

/**
 * Extract the full Solidity source from a tagged template, resolving interpolations.
 * Returns undefined if any interpolation can't be statically resolved.
 */
export function extractTemplateSource(
  ts: TS,
  template: typescript.TemplateLiteral,
  sourceFile: typescript.SourceFile,
): string | undefined {
  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    return template.text;
  }

  let result = template.head.text;
  for (const span of template.templateSpans) {
    const resolved = resolveStringExpression(ts, span.expression, sourceFile);
    if (resolved === undefined) return undefined;
    result += resolved + span.literal.text;
  }
  return result;
}
