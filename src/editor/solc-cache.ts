/**
 * In-plugin compilation cache.
 * Shares solc types and input-building with the runtime compiler,
 * but maintains a separate cache keyed by raw source string
 * (no hashing needed in the plugin environment).
 */
import {
  buildSolcInput,
  type SolcAbiItem,
  type SolcAbiParam,
  type SolcModule,
  type SolcStandardOutput,
} from "../solc.js";

export type { SolcAbiItem, SolcAbiParam, SolcStandardOutput };

// The LS plugin always runs in tsserver (CJS), so require is available natively.
let solcInstance: SolcModule | undefined;

function getSolc(): SolcModule {
  if (!solcInstance) {
    try {
      solcInstance = require("solc") as SolcModule;
    } catch {
      throw new Error(
        "soltag: solc is not installed. Install it (`pnpm add solc`) for IDE features like completions and diagnostics.",
      );
    }
  }
  return solcInstance;
}

const cache = new Map<string, SolcStandardOutput>();

export function compileCached(source: string): SolcStandardOutput {
  const existing = cache.get(source);
  if (existing) return existing;

  const solc = getSolc();
  const input = buildSolcInput(source);
  const rawOutput = solc.compile(JSON.stringify(input));
  const output = JSON.parse(rawOutput) as SolcStandardOutput;

  cache.set(source, output);
  return output;
}

/**
 * Get the ABI for a specific contract by name.
 */
export function getContractAbi(output: SolcStandardOutput, contractName: string): SolcAbiItem[] | undefined {
  if (!output.contracts) return undefined;
  for (const fileContracts of Object.values(output.contracts)) {
    if (contractName in fileContracts) {
      return fileContracts[contractName].abi;
    }
  }
  return undefined;
}

/**
 * Get the constructor inputs for a specific contract by name.
 * Returns an empty array if the contract has no constructor or no inputs.
 */
export function getConstructorInputs(output: SolcStandardOutput, contractName: string): SolcAbiParam[] {
  const abi = getContractAbi(output, contractName);
  if (!abi) return [];

  const ctor = abi.find((item) => item.type === "constructor");
  return ctor?.inputs ?? [];
}
