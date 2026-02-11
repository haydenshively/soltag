/**
 * Shared solc-js types, helpers, and compilation cache used by both
 * the bundler plugin and the LS / editor plugin.
 */

import type { Abi, Hex } from "viem";

import type { CompilationResult } from "./index.js";

let solcInstance: { compile(input: string): string } | undefined;

function getSolc() {
  if (!solcInstance) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      solcInstance = require("solc") as typeof solcInstance;
    } catch {
      throw new Error("soltag: solc is not installed. Install it (`pnpm add solc`) for compilation.");
    }
  }
  return solcInstance!;
}

export interface SolcInputOptions {
  optimizer?: {
    enabled?: boolean;
    runs?: number;
  };
}

function buildSolcInput(source: string, options?: SolcInputOptions) {
  return {
    language: "Solidity" as const,
    sources: {
      "inline.sol": { content: source },
    },
    settings: {
      optimizer: {
        enabled: options?.optimizer?.enabled ?? true,
        runs: options?.optimizer?.runs ?? 1,
      },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
        },
      },
    },
  };
}

// --- solc standard output types ---

export interface SolcStandardOutput {
  contracts?: Record<
    string,
    Record<
      string,
      {
        abi: {
          type: string;
          name?: string;
          inputs?: SolcAbiParam[];
          outputs?: SolcAbiParam[];
          stateMutability?: string;
        }[];
        evm: {
          bytecode: { object: string };
          deployedBytecode: { object: string };
        };
      }
    >
  >;
  errors?: {
    severity: string;
    message: string;
    formattedMessage: string;
    sourceLocation?: {
      file: string;
      start: number;
      end: number;
    };
  }[];
}

export interface SolcAbiParam {
  name: string;
  type: string;
  components?: SolcAbiParam[];
  internalType?: string;
}

// --- compilation cache ---

const cache = new Map<string, SolcStandardOutput>();

export function compileCached(source: string, options?: SolcInputOptions): SolcStandardOutput {
  const key = source + JSON.stringify(options ?? {});
  const existing = cache.get(key);
  if (existing) return existing;

  const solc = getSolc();
  const input = buildSolcInput(source, options);
  const rawOutput = solc.compile(JSON.stringify(input));
  const output = JSON.parse(rawOutput) as SolcStandardOutput;

  cache.set(key, output);
  return output;
}

// --- ABI helpers ---

export function getContractAbi(output: SolcStandardOutput, contractName: string) {
  if (!output.contracts) return undefined;
  for (const fileContracts of Object.values(output.contracts)) {
    if (contractName in fileContracts) {
      return fileContracts[contractName].abi;
    }
  }
  return undefined;
}

export function getConstructorInputs(output: SolcStandardOutput, contractName: string): SolcAbiParam[] {
  const abi = getContractAbi(output, contractName);
  if (!abi) return [];
  const ctor = abi.find((item) => item.type === "constructor");
  return ctor?.inputs ?? [];
}

// --- compile to artifacts ---

export function compileToArtifacts(source: string, options?: SolcInputOptions): CompilationResult {
  const output = compileCached(source, options);

  if (output.errors) {
    const errors = output.errors.filter((e) => e.severity === "error");
    if (errors.length > 0) {
      const formatted = errors.map((e) => `error: ${e.message}`).join("\n");
      throw new Error(`Solidity compilation failed:\n${formatted}`);
    }
  }

  const result: CompilationResult = {};

  if (output.contracts) {
    for (const [, fileContracts] of Object.entries(output.contracts)) {
      for (const [contractName, contractOutput] of Object.entries(fileContracts)) {
        result[contractName] = {
          abi: contractOutput.abi as Abi,
          deployedBytecode: `0x${contractOutput.evm.deployedBytecode.object}` as Hex,
          bytecode: `0x${contractOutput.evm.bytecode.object}` as Hex,
        };
      }
    }
  }

  return result;
}
