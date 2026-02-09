import { createRequire } from "node:module";

import { type Abi, concat, type Hex, keccak256, toHex } from "viem";

import { buildSolcInput, type SolcError, type SolcModule, type SolcStandardOutput } from "../solc.js";

const require = createRequire(import.meta.url);

let solcInstance: SolcModule | undefined;

function getSolc(): SolcModule {
  if (!solcInstance) {
    try {
      solcInstance = require("solc") as SolcModule;
    } catch {
      throw new Error(
        "solc is not installed. Install it (`pnpm add solc`) for runtime compilation, " +
          "or use the soltag bundler plugin for build-time compilation.",
      );
    }
  }
  return solcInstance;
}

export type { SolcAbiItem, SolcAbiParam } from "../solc.js";

export interface CompiledContract {
  abi: Abi;
  /** Runtime bytecode (what lives at the contract address). Used with stateOverride. */
  deployedBytecode: Hex;
  /** Init bytecode (constructor + deployment code). Used for actual deployment. */
  initBytecode: Hex;
}

export type CompilationResult = Record<string, CompiledContract>;

export interface SolcDiagnostic {
  severity: "error" | "warning";
  message: string;
  formattedMessage: string;
  sourceLocation?: {
    file: string;
    start: number;
    end: number;
  };
}

export class SolCompilationError extends Error {
  constructor(public readonly errors: SolcDiagnostic[]) {
    const formatted = errors.map((e) => `${e.severity}: ${e.message}`).join("\n");
    super(`Solidity compilation failed:\n${formatted}`);
    this.name = "SolCompilationError";
  }
}

// Cache compiled results by source hash
const compilationCache = new Map<string, CompilationResult>();

export function hashSource(source: string): Hex {
  return keccak256(toHex(source));
}

/**
 * Hash compiled artifacts by their deployed bytecodes.
 * Used for deterministic address derivation — immune to source whitespace changes.
 */
export function hashArtifacts(artifacts: CompilationResult): Hex {
  const bytecodes = Object.keys(artifacts)
    .sort()
    .map((name) => artifacts[name].deployedBytecode);
  return keccak256(bytecodes.length > 0 ? concat(bytecodes) : "0x");
}

export function compile(source: string): CompilationResult {
  const hash = hashSource(source);
  const cached = compilationCache.get(hash);
  if (cached) return cached;

  const solc = getSolc();
  const input = buildSolcInput(source);
  const rawOutput = solc.compile(JSON.stringify(input));
  const output = JSON.parse(rawOutput) as SolcStandardOutput;

  const diagnostics = toDiagnostics(output.errors);
  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    throw new SolCompilationError(errors);
  }

  const result: CompilationResult = {};

  if (output.contracts) {
    for (const [, fileContracts] of Object.entries(output.contracts)) {
      for (const [contractName, contractOutput] of Object.entries(fileContracts)) {
        result[contractName] = {
          abi: contractOutput.abi as Abi,
          deployedBytecode: `0x${contractOutput.evm.deployedBytecode.object}` as Hex,
          initBytecode: `0x${contractOutput.evm.bytecode.object}` as Hex,
        };
      }
    }
  }

  compilationCache.set(hash, result);
  return result;
}

function toDiagnostics(errors: SolcError[] | undefined): SolcDiagnostic[] {
  return (errors ?? []).map((e) => ({
    severity: e.severity as "error" | "warning",
    message: e.message,
    formattedMessage: e.formattedMessage,
    sourceLocation: e.sourceLocation,
  }));
}
