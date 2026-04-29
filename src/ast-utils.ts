import * as fs from "fs";
import * as path from "path";

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
 * Thrown when a `solFile(...)` interpolation can't read the requested file.
 * Carries the call-site node so editor diagnostics can paint the squiggle on
 * the right span.
 */
export class SolFileError extends Error {
  readonly filePath: string;
  readonly cause: NodeJS.ErrnoException;
  readonly node: typescript.Node;

  constructor(args: { filePath: string; cause: NodeJS.ErrnoException; node: typescript.Node }) {
    super(`solFile("${args.filePath}") failed: ${args.cause.message}`);
    this.name = "SolFileError";
    this.filePath = args.filePath;
    this.cause = args.cause;
    this.node = args.node;
  }
}

/**
 * Strip the leading SPDX-License-Identifier comment and `pragma` directives
 * from a Solidity source. Stops at the first non-blank, non-header line.
 *
 * The lens template owns the pragma; helpers contribute contract bodies.
 * Set `{ raw: true }` on the `solFile` call to opt out.
 */
export function stripSolidityHeader(src: string): string {
  const lines = src.split("\n");
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    if (/^\/\/\s*SPDX-License-Identifier:/i.test(line)) continue;
    if (/^pragma\s+(?:solidity|abicoder|experimental)\b/.test(line)) continue;
    break;
  }
  return lines.slice(i).join("\n");
}

/**
 * Try to resolve a TS expression to a string constant at build time.
 * Returns the resolved string, or undefined if the expression can't be statically resolved.
 *
 * Throws {@link SolFileError} if a `solFile(...)` call resolved its arguments
 * statically but the underlying file read failed.
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

  // solFile(path, opts?) — read the file at build time, splice contents
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "solFile") {
    return resolveSolFileCall(ts, node, sourceFile);
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
 * Resolve `solFile(path, opts?)`: read the file (relative to the .ts file's
 * directory) and splice the (optionally header-stripped) contents. Returns
 * undefined if any argument can't be resolved at build time.
 *
 * No caching: file reads are cheap, and re-reading on every resolution lets
 * the editor pick up `.sol` edits on its next poll without restarting.
 *
 * Throws {@link SolFileError} on file-read failure.
 */
function resolveSolFileCall(
  ts: TS,
  node: typescript.CallExpression,
  sourceFile: typescript.SourceFile,
): string | undefined {
  if (node.arguments.length < 1 || node.arguments.length > 2) return undefined;

  const filePath = resolveStringExpression(ts, node.arguments[0], sourceFile);
  if (filePath === undefined) return undefined;

  let rawOpt = false;
  if (node.arguments.length === 2) {
    const opts = node.arguments[1];
    if (!ts.isObjectLiteralExpression(opts)) return undefined;
    for (const prop of opts.properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) return undefined;
      const key = prop.name.text;
      if (key === "raw") {
        if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) rawOpt = true;
        else if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) rawOpt = false;
        else return undefined;
      } else {
        return undefined;
      }
    }
  }

  const baseDir = path.dirname(sourceFile.fileName);
  const absPath = path.resolve(baseDir, filePath);

  let contents: string;
  try {
    contents = fs.readFileSync(absPath, "utf-8");
  } catch (err) {
    throw new SolFileError({
      filePath: absPath,
      cause: err as NodeJS.ErrnoException,
      node,
    });
  }

  return rawOpt ? contents : stripSolidityHeader(contents);
}

/**
 * Extract the full Solidity source from a tagged template, resolving interpolations.
 * Returns undefined if any interpolation can't be statically resolved.
 *
 * Throws {@link SolFileError} if a `solFile(...)` interpolation's file read
 * failed — callers should catch this to render a useful diagnostic.
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
