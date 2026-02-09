import type { Abi, Hex, PublicClient } from "viem";

import { type CompilationResult, type CompiledContract, compile, hashArtifacts } from "./compiler.js";
import { deriveAddress, executeCall } from "./execution.js";

// biome-ignore lint/correctness/noUnusedVariables: TName enables generic type narrowing via module augmentation
export class SolContract<TName extends string = string> {
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
   */
  static fromArtifacts<T extends string = string>(artifacts: CompilationResult): SolContract<T> {
    const instance = new SolContract("");
    instance._compiled = artifacts;
    instance._address = deriveAddress(hashArtifacts(artifacts));
    return instance as SolContract<T>;
  }

  private ensureCompiled(): CompilationResult {
    if (!this._compiled) {
      this._compiled = compile(this._source);
    }
    return this._compiled;
  }

  private getAddress(): Hex {
    if (!this._address) {
      this._address = deriveAddress(hashArtifacts(this.ensureCompiled()));
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

  call(client: PublicClient, functionName: never, args?: readonly unknown[]): Promise<never>;
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
