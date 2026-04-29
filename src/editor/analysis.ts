import type tslib from "typescript/lib/tsserverlibrary";

import { extractTemplateSource, isSolTag, SolFileError } from "../ast-utils.js";

export interface SolLiteralInfo {
  /** Solidity source text, or undefined if the template has unresolvable interpolations or solFile failure */
  source: string | undefined;
  /** Contract name from sol("Name") factory form */
  contractName: string;
  /** Position of the template literal expression in the source file */
  pos: number;
  /** End position */
  end: number;
  /** The node itself */
  node: tslib.TaggedTemplateExpression;
  /** Populated when a `solFile(...)` interpolation failed at read time */
  resolverError?: { node: tslib.Node; message: string };
}

/**
 * Check if a tag expression is a sol("Name") call expression.
 * Returns the contract name, or false if the tag is not a sol tag.
 *
 * NOTE: This detection logic is mirrored in bundler/unplugin.ts for the build plugin,
 * which uses `typescript` directly instead of `tsserverlibrary`.
 */
export { isSolTag };

/**
 * Find all `sol("Name")` tagged template expressions in a source file.
 */
export function findSolTemplateLiterals(ts: typeof tslib, sourceFile: tslib.SourceFile): SolLiteralInfo[] {
  const results: SolLiteralInfo[] = [];

  function visit(node: tslib.Node) {
    if (ts.isTaggedTemplateExpression(node)) {
      const solTag = isSolTag(ts, node.tag);
      if (solTag !== false) {
        let source: string | undefined;
        let resolverError: SolLiteralInfo["resolverError"];
        try {
          source = extractTemplateSource(ts, node.template, sourceFile as unknown as tslib.SourceFile);
        } catch (err) {
          if (err instanceof SolFileError) {
            resolverError = {
              node: err.node as unknown as tslib.Node,
              message: err.message,
            };
          } else {
            throw err;
          }
        }
        results.push({
          source,
          contractName: solTag.contractName,
          pos: node.pos,
          end: node.end,
          node,
          resolverError,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}
