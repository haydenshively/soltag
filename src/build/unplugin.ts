import * as fs from "fs";
import * as path from "path";

import MagicString from "magic-string";
import ts from "typescript";
import { createUnplugin } from "unplugin";

import { type ContractTypeEntry, type FunctionOverload, generateDeclarationContent } from "../plugin/codegen.js";
import { compile } from "../runtime/compiler.js";
import type { SolcAbiParam } from "../solc.js";

export interface SoltagPluginOptions {
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
 * Extract callable functions from a compiled contract's viem Abi.
 */
function extractCallableFunctions(abi: readonly Record<string, unknown>[]): FunctionOverload[] {
  const functions: FunctionOverload[] = [];

  for (const item of abi) {
    if (
      item.type === "function" &&
      (item.stateMutability === "view" || item.stateMutability === "pure") &&
      typeof item.name === "string"
    ) {
      functions.push({
        name: item.name,
        inputs: (item.inputs ?? []) as SolcAbiParam[],
        outputs: (item.outputs ?? []) as SolcAbiParam[],
      });
    }
  }

  return functions;
}

/**
 * Core transform logic, exported for testing.
 */
export function transformSolTemplates(
  code: string,
  id: string,
  namedEntries?: Map<string, ContractTypeEntry>,
): { code: string; map: ReturnType<MagicString["generateMap"]> } | undefined {
  if (!code.includes("sol`") && !code.includes("sol `") && !code.includes("sol(")) return undefined;

  const sourceFile = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
  const s = new MagicString(code);
  let hasReplacements = false;

  function visit(node: ts.Node) {
    if (ts.isTaggedTemplateExpression(node)) {
      let contractName: string | undefined;
      let isSol = false;

      if (ts.isIdentifier(node.tag) && node.tag.text === "sol") {
        // Plain form: sol`...`
        isSol = true;
      } else if (
        ts.isCallExpression(node.tag) &&
        ts.isIdentifier(node.tag.expression) &&
        node.tag.expression.text === "sol" &&
        node.tag.arguments.length === 1 &&
        ts.isStringLiteral(node.tag.arguments[0])
      ) {
        // Factory form: sol("Name")`...`
        isSol = true;
        contractName = node.tag.arguments[0].text;
      }

      if (isSol) {
        const soliditySource = extractTemplateSource(node.template, sourceFile);
        if (soliditySource === undefined) {
          // Can't resolve at build time — leave for runtime
          return;
        }

        const artifacts = compile(soliditySource);

        // Collect named entries for .d.ts generation
        if (contractName != null && namedEntries != null) {
          const functions = Object.values(artifacts).flatMap((c) =>
            extractCallableFunctions(c.abi as unknown as Record<string, unknown>[]),
          );
          namedEntries.set(`${contractName}\0${soliditySource}`, {
            contractName,
            functions,
          });
        }

        const generic = contractName != null ? `<${JSON.stringify(contractName)}>` : "";
        const replacement = `__SolContract.fromArtifacts${generic}(${JSON.stringify(artifacts)})`;
        s.overwrite(node.getStart(sourceFile), node.getEnd(), replacement);
        hasReplacements = true;
        return; // Don't visit children
      }
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

const TYPES_DIR = ".soltag";
const TYPES_FILE = "types.d.ts";

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

    transformInclude(id: string) {
      if (exclude.some((e) => e.test(id))) return false;
      return include.some((ext) => id.endsWith(ext));
    },

    transform(code: string, id: string) {
      if (!rootDir) {
        rootDir = process.cwd();
      }
      return transformSolTemplates(code, id, namedEntries);
    },

    buildEnd() {
      if (!rootDir || namedEntries.size === 0) return;

      const entries = Array.from(namedEntries.values());
      const { content } = generateDeclarationContent(entries);

      if (content === "") return;

      const typesDir = path.join(rootDir, TYPES_DIR);
      const typesFile = path.join(typesDir, TYPES_FILE);

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
