import type tslib from "typescript/lib/tsserverlibrary";

export interface SolLiteralInfo {
  /** Solidity source text, or undefined if the template has unresolvable interpolations */
  source: string | undefined;
  /** Contract name from sol("Name") factory form, or undefined for plain sol`` */
  contractName: string | undefined;
  /** Position of the template literal expression in the source file */
  pos: number;
  /** End position */
  end: number;
  /** The node itself */
  node: tslib.TaggedTemplateExpression;
}

/**
 * Check if a tag expression is a sol tag.
 * Recognizes both `sol` (identifier) and `sol("Name")` (call expression with string literal arg).
 * Returns the contract name for the factory form, or undefined for the plain form.
 * Returns false if the tag is not a sol tag.
 *
 * NOTE: This detection logic is mirrored in bundler/unplugin.ts for the build plugin,
 * which uses `typescript` directly instead of `tsserverlibrary`.
 */
export function isSolTag(ts: typeof tslib, tag: tslib.Node): { contractName: string | undefined } | false {
  // Plain form: sol`...`
  if (ts.isIdentifier(tag) && tag.text === "sol") {
    return { contractName: undefined };
  }
  // Factory form: sol("Name")`...`
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
 * Find all `sol` tagged template expressions in a source file.
 * Recognizes both `sol`...`` and `sol("Name")`...`` forms.
 */
export function findSolTemplateLiterals(ts: typeof tslib, sourceFile: tslib.SourceFile): SolLiteralInfo[] {
  const results: SolLiteralInfo[] = [];

  function visit(node: tslib.Node) {
    if (ts.isTaggedTemplateExpression(node)) {
      const solTag = isSolTag(ts, node.tag);
      if (solTag !== false) {
        results.push({
          source: extractTemplateText(ts, node.template),
          contractName: solTag.contractName,
          pos: node.pos,
          end: node.end,
          node,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

/**
 * Information about a `.call()` expression on a sol-derived variable.
 */
export interface CallSiteInfo {
  /** The Solidity source from the sol`` literal */
  soliditySource: string;
  /** The function name argument node (if it's a string literal) */
  functionNameNode: tslib.StringLiteral | undefined;
  /** The function name string (if available) */
  functionName: string | undefined;
  /** The args argument node (if present) */
  argsNode: tslib.Node | undefined;
  /** The full .call() expression */
  callExpression: tslib.CallExpression;
}

/**
 * Check if a position is inside a `.call()` on a sol-derived variable.
 * Returns info about the call site, or undefined if not applicable.
 */
export function getCallSiteAtPosition(
  ts: typeof tslib,
  sourceFile: tslib.SourceFile,
  position: number,
): CallSiteInfo | undefined {
  const node = findNodeAtPosition(ts, sourceFile, position);
  if (!node) return undefined;

  // Walk up to find a CallExpression
  const callExpr = findAncestor(node, ts.isCallExpression);
  if (!callExpr) return undefined;

  // Check if it's a `.call(...)` expression
  const expr = callExpr.expression;
  if (!ts.isPropertyAccessExpression(expr)) return undefined;
  if (expr.name.text !== "call") return undefined;

  // Trace the object back to a sol`` literal
  const soliditySource = traceToSolLiteral(ts, expr.expression, sourceFile);
  if (!soliditySource) return undefined;

  // Extract arguments
  const args = callExpr.arguments;
  // .call(client, functionName, args)
  const functionNameArg = args.length >= 2 ? args[1] : undefined;
  const argsArg = args.length >= 3 ? args[2] : undefined;

  return {
    soliditySource,
    functionNameNode: functionNameArg && ts.isStringLiteral(functionNameArg) ? functionNameArg : undefined,
    functionName: functionNameArg && ts.isStringLiteral(functionNameArg) ? functionNameArg.text : undefined,
    argsNode: argsArg,
    callExpression: callExpr,
  };
}

/**
 * Trace an expression back to a `sol` tagged template literal.
 * Returns the Solidity source string, or undefined if the expression
 * doesn't trace back to a sol`` literal.
 */
export function traceToSolLiteral(
  ts: typeof tslib,
  node: tslib.Node,
  sourceFile: tslib.SourceFile,
): string | undefined {
  // Direct: sol`...`.call(...) or sol("Name")`...`.call(...)
  if (ts.isTaggedTemplateExpression(node) && isSolTag(ts, node.tag) !== false) {
    return extractTemplateText(ts, node.template);
  }

  // Variable reference: const x = sol`...`; x.call(...)
  // or: const x = sol("Name")`...`; x.call(...)
  if (ts.isIdentifier(node)) {
    const declaration = findVariableDeclaration(ts, node, sourceFile);
    if (
      declaration?.initializer &&
      ts.isTaggedTemplateExpression(declaration.initializer) &&
      isSolTag(ts, declaration.initializer.tag) !== false
    ) {
      return extractTemplateText(ts, declaration.initializer.template);
    }
  }

  return undefined;
}

function extractTemplateText(ts: typeof tslib, template: tslib.TemplateLiteral): string | undefined {
  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    return template.text;
  }
  // Template has interpolations — can't resolve statically in the plugin
  return undefined;
}

/**
 * Find the variable declaration for an identifier by walking the AST.
 */
function findVariableDeclaration(
  ts: typeof tslib,
  identifier: tslib.Identifier,
  sourceFile: tslib.SourceFile,
): tslib.VariableDeclaration | undefined {
  const name = identifier.text;
  let result: tslib.VariableDeclaration | undefined;

  function visit(node: tslib.Node) {
    if (result) return;

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      result = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return result;
}

/**
 * Find the innermost node at a given position.
 */
function findNodeAtPosition(ts: typeof tslib, sourceFile: tslib.SourceFile, position: number): tslib.Node | undefined {
  let result: tslib.Node | undefined;

  function visit(node: tslib.Node) {
    if (position >= node.getStart(sourceFile) && position < node.getEnd()) {
      result = node;
      ts.forEachChild(node, visit);
    }
  }

  visit(sourceFile);
  return result;
}

/**
 * Walk up the AST to find an ancestor matching a predicate.
 */
function findAncestor<T extends tslib.Node>(
  node: tslib.Node,
  predicate: (node: tslib.Node) => node is T,
): T | undefined {
  let current: tslib.Node | undefined = node;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return undefined;
}

/**
 * Determine which argument position (0-based) the cursor is in
 * within a call expression.
 */
export function getArgumentIndex(
  callExpression: tslib.CallExpression,
  position: number,
  sourceFile: tslib.SourceFile,
): number {
  const args = callExpression.arguments;
  for (let i = args.length - 1; i >= 0; i--) {
    if (position >= args[i].getStart(sourceFile)) {
      return i;
    }
  }
  // Before first arg or in the parens
  return 0;
}
