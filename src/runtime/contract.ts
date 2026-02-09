import { type Abi, type Hex, type PublicClient, keccak256, toHex } from "viem";
import { compile, hashSource, type CompilationResult, type CompiledContract } from "./compiler.js";
import { deriveAddress, executeCall } from "./execution.js";

export class SolContract {
  private _source: string;
  private _compiled: CompilationResult | undefined;
  private _address: Hex | undefined;
  private _abi: Abi | undefined;

  constructor(source: string) {
    this._source = source;
  }

  /**
   * Create a SolContract from pre-compiled artifacts.
   * Used by the bundler plugin to bypass runtime solc compilation.
   *
   * @param artifacts - Pre-compiled contract artifacts (ABI + bytecode per contract name)
   * @param sourceHash - keccak256 of the original Solidity source, for deterministic address derivation
   */
  static fromArtifacts(artifacts: CompilationResult, sourceHash?: Hex): SolContract {
    const instance = new SolContract("");
    instance._compiled = artifacts;
    if (sourceHash) {
      instance._address = deriveAddress(sourceHash);
    }
    return instance;
  }

  private ensureCompiled(): CompilationResult {
    if (!this._compiled) {
      this._compiled = compile(this._source);
    }
    return this._compiled;
  }

  private getAddress(): Hex {
    if (!this._address) {
      if (this._source) {
        this._address = deriveAddress(hashSource(this._source));
      } else {
        // fromArtifacts without sourceHash — derive from artifact content
        this._address = deriveAddress(keccak256(toHex(JSON.stringify(this._compiled))));
      }
    }
    return this._address;
  }

  get abi(): Abi {
    if (!this._abi) {
      const compiled = this.ensureCompiled();
      this._abi = Object.values(compiled).flatMap((c) => c.abi) as Abi;
    }
    return this._abi;
  }

  async call(client: PublicClient, functionName: string, args: readonly unknown[] = []): Promise<unknown> {
    const compiled = this.ensureCompiled();
    const { contract } = findContract(compiled, functionName);
    const address = this.getAddress();

    return executeCall(client, address, contract.deployedBytecode, contract.abi, functionName, args);
  }
}

/**
 * Find which compiled contract contains the given function name.
 */
function findContract(compiled: CompilationResult, functionName: string): { name: string; contract: CompiledContract } {
  for (const [name, contract] of Object.entries(compiled)) {
    const hasFunction = contract.abi.some((item) => "name" in item && item.name === functionName);
    if (hasFunction) {
      return { name, contract };
    }
  }

  const available = Object.keys(compiled).join(", ");
  throw new Error(`Function "${functionName}" not found in any compiled contract. Available contracts: ${available}`);
}
