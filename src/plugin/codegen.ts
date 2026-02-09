import type { SolcAbiParam } from "../solc.js";

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
 * Format a function's return type for display.
 */
export function formatReturnType(outputs: SolcAbiParam[]): string {
  if (outputs.length === 0) return "void";
  if (outputs.length === 1) return solidityTypeToTs(outputs[0]);
  // Multiple returns → tuple
  return `[${outputs.map((o) => solidityTypeToTs(o)).join(", ")}]`;
}

export interface FunctionOverload {
  name: string;
  inputs: SolcAbiParam[];
  outputs: SolcAbiParam[];
}

export interface ContractTypeEntry {
  contractName: string;
  functions: FunctionOverload[];
}

export interface GenerationResult {
  content: string;
  /** Contract names that appear more than once with different function signatures */
  duplicates: string[];
}

/**
 * Generate the content of a `.d.ts` file with `call()` overloads
 * for all named sol contracts.
 *
 * Accepts pre-compiled entries so this module has no solc dependency
 * and can be shared between the tsserver plugin and the bundler.
 */
export function generateDeclarationContent(entries: ContractTypeEntry[]): GenerationResult {
  if (entries.length === 0) return { content: "", duplicates: [] };

  // Detect duplicates: same contractName, different function sets
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
      const fingerprints = new Set(group.map((e) => JSON.stringify(e.functions)));
      if (fingerprints.size > 1) {
        duplicates.push(name);
      }
    }
  }

  const overloads: string[] = [];

  for (const entry of unique) {
    for (const fn of entry.functions) {
      const argTypes = fn.inputs.map((p) => solidityTypeToTs(p));
      const argsType =
        argTypes.length === 0
          ? "readonly []"
          : `readonly [${argTypes.join(", ")}]`;
      const returnType = formatReturnType(fn.outputs);

      overloads.push(
        `      call(this: SolContract<${JSON.stringify(entry.contractName)}>, client: import("viem").PublicClient, fn: ${JSON.stringify(fn.name)}, args: ${argsType}): Promise<${returnType}>;`,
      );
    }
  }

  if (overloads.length === 0) return { content: "", duplicates };

  const content = `export {}
declare module "soltag" {
  interface SolContract<TName extends string> {
${overloads.join("\n")}
  }
}
`;

  return { content, duplicates };
}
