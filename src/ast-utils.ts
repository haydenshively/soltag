import type { CallExpression, Expression, Identifier, Node, SourceFile, TemplateLiteral } from "typescript";

// Define a minimal shape for the TS module to avoid hard dependency on specific version
export interface TsModule {
  isCallExpression(node: Node): node is CallExpression;
  isIdentifier(node: Node): node is Identifier;
  isStringLiteral(node: Node): node is { text: string } & Node;
  isNoSubstitutionTemplateLiteral(node: Node): node is { text: string } & Node;
  isTemplateExpression(
    node: Node,
  ): node is { head: { text: string }; templateSpans: { expression: Expression; literal: { text: string } }[] } & Node;
  isVariableStatement(node: Node): boolean;
  isBinaryExpression(node: Node): boolean;
  SyntaxKind: {
    PlusToken: number;
  };
  NodeFlags: {
    Const: number;
  };
}

/**
 * Check if a tag expression is a sol("Name") call expression.
 * Returns the contract name, or false if the tag is not a sol tag.
 */
export function isSolTag(ts: TsModule, tag: Node): { contractName: string } | false {
  if (
    ts.isCallExpression(tag) &&
    ts.isIdentifier(tag.expression) &&
    tag.expression.text === "sol" &&
    (tag.arguments as unknown as Node[]).length === 1 &&
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
export function resolveStringExpression(ts: TsModule, node: Expression, sourceFile: SourceFile): string | undefined {
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
  // @ts-expect-error - BinaryExpression structure is complex to type perfectly with minimal interface
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    // @ts-expect-error
    const left = resolveStringExpression(ts, node.left, sourceFile);
    // @ts-expect-error
    const right = resolveStringExpression(ts, node.right, sourceFile);
    if (left !== undefined && right !== undefined) return left + right;
    return undefined;
  }

  return undefined;
}

/**
 * Find a const declaration for an identifier and resolve its string value.
 */
function resolveIdentifierToString(ts: TsModule, identifier: Identifier, sourceFile: SourceFile): string | undefined {
  const name = identifier.text;

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    // @ts-expect-error - isVariableStatement returns boolean, not a type predicate
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;

    // @ts-expect-error - same as above
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
  ts: TsModule,
  template: TemplateLiteral,
  sourceFile: SourceFile,
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
