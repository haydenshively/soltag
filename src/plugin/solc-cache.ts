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
    solcInstance = require("solc") as SolcModule;
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
 * Extract all ABI items from a compilation result.
 */
export function extractAllAbis(output: SolcStandardOutput): SolcAbiItem[] {
  if (!output.contracts) return [];

  return Object.values(output.contracts).flatMap((fileContracts) =>
    Object.values(fileContracts).flatMap((contract) => contract.abi),
  );
}

/**
 * Get all view/pure function names from compiled output.
 */
export function getCallableFunctionNames(output: SolcStandardOutput): string[] {
  return extractAllAbis(output)
    .filter((item) => item.type === "function" && (item.stateMutability === "view" || item.stateMutability === "pure"))
    .map((item) => item.name!)
    .filter(Boolean);
}

/**
 * Find a specific function's ABI item by name.
 */
export function findFunctionAbi(output: SolcStandardOutput, functionName: string): SolcAbiItem | undefined {
  return extractAllAbis(output).find((item) => item.type === "function" && item.name === functionName);
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
