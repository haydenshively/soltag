/**
 * Shared solc-js types and helpers used by both the runtime compiler
 * and the LS plugin cache.
 */

export interface SolcModule {
  compile(input: string): string;
}

/**
 * Build the standard JSON input object for solc.
 */
export function buildSolcInput(source: string) {
  return {
    language: "Solidity" as const,
    sources: {
      "inline.sol": { content: source },
    },
    settings: {
      optimizer: { enabled: true, runs: 1 },
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
  contracts?: Record<string, Record<string, SolcContractOutput>>;
  errors?: SolcError[];
}

export interface SolcContractOutput {
  abi: SolcAbiItem[];
  evm: {
    bytecode: { object: string };
    deployedBytecode: { object: string };
  };
}

export interface SolcAbiItem {
  type: string;
  name?: string;
  inputs?: SolcAbiParam[];
  outputs?: SolcAbiParam[];
  stateMutability?: string;
}

export interface SolcAbiParam {
  name: string;
  type: string;
  components?: SolcAbiParam[];
  internalType?: string;
}

export interface SolcError {
  severity: string;
  message: string;
  formattedMessage: string;
  sourceLocation?: {
    file: string;
    start: number;
    end: number;
  };
}
