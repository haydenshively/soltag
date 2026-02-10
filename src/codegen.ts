import type { SolcAbiParam } from "./solc.js";

export const SOLTAG_DIR = ".soltag";
export const SOLTAG_TYPES_FILE = "types.d.ts";

/**
 * Map a Solidity type to a TypeScript type string for display.
 */
export function solidityTypeToTs(param: SolcAbiParam): string {
  const t = param.type;

  if (t === "address") return "`0x${string}`";
  if (t === "bool") return "boolean";
  if (t === "string") return "string";
  if (t === "bytes" || t.match(/^bytes\d+$/)) return "`0x${string}`";

  if (t.match(/^u?int\d*$/)) return "bigint";

  // Arrays
  if (t.endsWith("[]")) {
    const inner = { ...param, type: t.slice(0, -2) };
    return `${solidityTypeToTs(inner)}[]`;
  }

  // Fixed-size arrays
  const fixedArray = t.match(/^(.+)\[(\d+)\]$/);
  if (fixedArray) {
    const inner = { ...param, type: fixedArray[1] };
    return `${solidityTypeToTs(inner)}[]`;
  }

  // Tuples
  if (t === "tuple" && param.components) {
    const fields = param.components.map((c) => `${c.name}: ${solidityTypeToTs(c)}`).join("; ");
    return `{ ${fields} }`;
  }

  return "unknown";
}

/**
 * Serialize a JSON-compatible value as a deeply-readonly TypeScript type literal.
 * Produces the same shape as `as const` would.
 */
export function jsonToConstType(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "readonly []";
    return `readonly [${value.map(jsonToConstType).join(", ")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const fields = entries.map(([k, v]) => `readonly ${k}: ${jsonToConstType(v)}`);
    return `{ ${fields.join("; ")} }`;
  }

  return "unknown";
}

export interface ContractTypeEntry {
  contractName: string;
  constructorInputs: SolcAbiParam[];
  abi: unknown[];
}

export interface GenerationResult {
  content: string;
  /** Contract names that appear more than once with different signatures */
  duplicates: string[];
}

/**
 * Generate the content of a `.d.ts` file with `InlineContractAbiMap` entries
 * and `bytecode()` overloads for all named sol contracts.
 *
 * Accepts pre-compiled entries so this module has no solc dependency
 * and can be shared between the tsserver plugin and the bundler.
 */
export function generateDeclarationContent(entries: ContractTypeEntry[]): GenerationResult {
  if (entries.length === 0) return { content: "", duplicates: [] };

  // Detect duplicates: same contractName, different signatures
  const byName = new Map<string, ContractTypeEntry[]>();
  for (const entry of entries) {
    const existing = byName.get(entry.contractName);
    if (existing) {
      existing.push(entry);
    } else {
      byName.set(entry.contractName, [entry]);
    }
  }

  const duplicates: string[] = [];
  const unique: ContractTypeEntry[] = [];

  for (const [name, group] of byName) {
    unique.push(group[0]);
    if (group.length > 1) {
      // Check if they actually differ
      const fingerprints = new Set(
        group.map((e) => JSON.stringify({ constructorInputs: e.constructorInputs, abi: e.abi })),
      );
      if (fingerprints.size > 1) {
        duplicates.push(name);
      }
    }
  }

  const abiMapEntries: string[] = [];
  const overloads: string[] = [];

  for (const entry of unique) {
    // ABI map entry
    abiMapEntries.push(`      ${JSON.stringify(entry.contractName)}: ${jsonToConstType(entry.abi)};`);

    // bytecode() overload
    const params = entry.constructorInputs.map((p, i) => {
      const name = p.name || `arg${i}`;
      return `${name}: ${solidityTypeToTs(p)}`;
    });

    overloads.push(
      `      bytecode(this: InlineContract<${JSON.stringify(entry.contractName)}>${params.length > 0 ? `, ${params.join(", ")}` : ""}): \`0x\${string}\`;`,
    );
  }

  if (unique.length === 0) return { content: "", duplicates };

  const content = `export {}
declare module "soltag" {
  interface InlineContractAbiMap {
${abiMapEntries.join("\n")}
  }
  interface InlineContract<TName extends string> {
${overloads.join("\n")}
  }
}
`;

  return { content, duplicates };
}
