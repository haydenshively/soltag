import MagicString from "magic-string";
import ts from "typescript";
import { createUnplugin } from "unplugin";

import { extractTemplateSource, isSolTag } from "../ast-utils.js";
import { compileToArtifacts } from "../solc.js";

export interface SoltagPluginOptions {
  /** Extra file extensions to include. Defaults to ['.ts', '.tsx', '.mts', '.cts'] */
  include?: string[];
  /** Patterns to exclude. Defaults to [/node_modules/] */
  exclude?: RegExp[];
  /** Solc compiler settings */
  solc?: {
    /** Optimizer settings */
    optimizer?: {
      enabled?: boolean;
      runs?: number;
    };
  };
}

/**
 * Core transform logic, exported for testing and the standalone webpack loader.
 */
export function transformSolTemplates(
  code: string,
  id: string,
  options?: SoltagPluginOptions,
): { code: string; map: ReturnType<MagicString["generateMap"]> } | undefined {
  // Regex fast-path: skip parsing if "sol" tag isn't present
  // Matches: sol("...") or sol('...') allow whitespace
  if (!/\bsol\s*\(\s*["'][^"']+["']\s*\)/.test(code)) return undefined;

  const sourceFile = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
  const s = new MagicString(code);
  let hasReplacements = false;

  function visit(node: ts.Node) {
    if (ts.isTaggedTemplateExpression(node)) {
      const solTag = isSolTag(ts, node.tag);
      if (solTag) {
        const soliditySource = extractTemplateSource(ts, node.template, sourceFile);

        if (soliditySource === undefined) {
          // Can't resolve at build time — leave for runtime
          return;
        }

        const artifacts = compileToArtifacts(soliditySource, options?.solc);

        const replacement = `new __InlineContract(${JSON.stringify(solTag.contractName)}, ${JSON.stringify(artifacts)})`;
        s.overwrite(node.getStart(sourceFile), node.getEnd(), replacement);
        hasReplacements = true;
        return; // Don't visit children
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (!hasReplacements) return undefined;

  s.prepend('import { InlineContract as __InlineContract } from "soltag";\n');

  return {
    code: s.toString(),
    map: s.generateMap({ source: id, hires: true }),
  };
}

export const unplugin = createUnplugin((options?: SoltagPluginOptions) => {
  const include = options?.include ?? [".ts", ".tsx", ".mts", ".cts"];
  const exclude = options?.exclude ?? [/node_modules/];

  return {
    name: "soltag",
    enforce: "pre" as const,

    transform: {
      filter: {
        id: {
          include: include.map((ext) => new RegExp(`${ext.replace(".", "\\.")}$`)),
          exclude,
        },
      },
      handler(code: string, id: string) {
        return transformSolTemplates(code, id, options);
      },
    },
  };
});

export default unplugin;
