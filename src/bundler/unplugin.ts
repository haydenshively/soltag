import * as fs from "fs";
import * as path from "path";

import MagicString from "magic-string";
import ts from "typescript";
import { createUnplugin } from "unplugin";

import { extractTemplateSource, isSolTag, type TsModule } from "../ast-utils.js";
import { type ContractTypeEntry, generateDeclarationContent, SOLTAG_DIR, SOLTAG_TYPES_FILE } from "../codegen.js";
import { compile } from "../runtime/compiler.js";
import type { SolcAbiParam } from "../solc.js";

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
 * Get constructor inputs from a compiled contract's ABI.
 */
function getConstructorInputs(abi: readonly Record<string, unknown>[]): SolcAbiParam[] {
  const ctor = abi.find((item) => item.type === "constructor");
  if (!ctor) return [];
  return (ctor.inputs ?? []) as SolcAbiParam[];
}

/**
 * Core transform logic, exported for testing.
 */
export function transformSolTemplates(
  code: string,
  id: string,
  namedEntries?: Map<string, ContractTypeEntry>,
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
      const solTag = isSolTag(ts as unknown as TsModule, node.tag);
      if (solTag) {
        const contractName = solTag.contractName;
        const soliditySource = extractTemplateSource(ts as unknown as TsModule, node.template, sourceFile);

        if (soliditySource === undefined) {
          // Can't resolve at build time — leave for runtime
          return;
        }

        const artifacts = compile(soliditySource, options?.solc);

        // Collect named entries for .d.ts generation
        if (namedEntries != null) {
          const contractArtifact = artifacts[contractName];
          const constructorInputs = contractArtifact
            ? getConstructorInputs(contractArtifact.abi as unknown as Record<string, unknown>[])
            : [];
          const abi = contractArtifact ? (contractArtifact.abi as unknown[]) : [];
          namedEntries.set(`${contractName}\0${soliditySource}`, {
            contractName,
            constructorInputs,
            abi,
          });
        }

        const replacement = `__InlineContract.fromArtifacts(${JSON.stringify(contractName)}, ${JSON.stringify(artifacts)})`;
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

  const namedEntries = new Map<string, ContractTypeEntry>();
  let rootDir: string | undefined;

  return {
    name: "soltag",
    enforce: "pre" as const,

    vite: {
      configResolved(config) {
        rootDir = config.root;
      },
    },

    buildStart() {
      namedEntries.clear();
    },

    transform: {
      filter: {
        id: {
          include: include.map((ext) => new RegExp(`${ext.replace(".", "\\.")}$`)),
          exclude,
        },
      },
      handler(code: string, id: string) {
        if (!rootDir) {
          rootDir = process.cwd();
        }
        return transformSolTemplates(code, id, namedEntries, options);
      },
    },

    buildEnd() {
      if (!rootDir || namedEntries.size === 0) return;

      const entries = Array.from(namedEntries.values());
      const { content, duplicates } = generateDeclarationContent(entries);

      for (const name of duplicates) {
        console.warn(
          `[soltag] Multiple contracts named "${name}" with different definitions exist in this project. Only the first definition will be used for type generation.`,
        );
      }

      if (content === "") return;

      const typesDir = path.join(rootDir, SOLTAG_DIR);
      const typesFile = path.join(typesDir, SOLTAG_TYPES_FILE);

      if (!fs.existsSync(typesDir)) {
        fs.mkdirSync(typesDir, { recursive: true });
      }

      let existing: string | undefined;
      try {
        existing = fs.readFileSync(typesFile, "utf-8");
      } catch {
        // File doesn't exist yet
      }

      if (existing !== content) {
        fs.writeFileSync(typesFile, content, "utf-8");
      }
    },
  };
});

export default unplugin;
