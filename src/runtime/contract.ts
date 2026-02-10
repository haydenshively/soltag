import { type Abi, type Address, encodeAbiParameters, getContractAddress, type Hex, zeroAddress } from "viem";

import { type CompilationResult, type CompiledContract, compile } from "./compiler.js";

export const CREATE2_FACTORY: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
export const CREATE2_SALT: Hex = `${zeroAddress}51A1E51A1E51A1E51A1E51A1`;

/**
 * Augment this interface via module augmentation to narrow the `abi` getter
 * for specific contract names. The generated `.soltag/types.d.ts` does this
 * automatically.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by generated .d.ts
export interface InlineContractAbiMap {}

export class InlineContract<TName extends string = string> {
  private _source: string;
  private _name: TName;
  private _compiled: CompilationResult | undefined;
  private _contract: CompiledContract | undefined;
  private _address: Address | undefined;

  constructor(source: string, name: TName) {
    this._source = source;
    this._name = name;
  }

  /**
   * Create a InlineContract from pre-compiled artifacts.
   * Used by the bundler plugin to bypass runtime solc compilation.
   */
  static fromArtifacts<T extends string>(name: T, artifacts: CompilationResult): InlineContract<T> {
    const instance = new InlineContract("", name);
    instance._compiled = artifacts;
    return instance as InlineContract<T>;
  }

  private ensureCompiled(): CompiledContract {
    if (!this._contract) {
      if (!this._compiled) {
        this._compiled = compile(this._source);
      }
      const contract = this._compiled[this._name];
      if (!contract) {
        const available = Object.keys(this._compiled).join(", ");
        throw new Error(`Contract "${this._name}" not found in compilation result. Available contracts: ${available}`);
      }
      this._contract = contract;
    }
    return this._contract;
  }

  get name(): TName {
    return this._name;
  }

  get abi(): TName extends keyof InlineContractAbiMap ? InlineContractAbiMap[TName] : Abi {
    return this.ensureCompiled().abi as TName extends keyof InlineContractAbiMap ? InlineContractAbiMap[TName] : Abi;
  }

  /**
   * The runtime bytecode of the named contract, as emitted by solc.
   *
   * **Immutables caveat:** If the contract declares `immutable` variables that
   * are assigned in the constructor, solc emits placeholder zeros in their
   * slots. The real values are only filled in during actual deployment (the
   * constructor runs and writes them into the runtime code). This means
   * `deployedBytecode` is unsuitable for `stateOverride` injection when the
   * contract relies on immutables — the zeroed slots will cause unexpected
   * behavior. In those cases, use `bytecode(…constructorArgs)` to get the
   * creation bytecode and deploy the contract normally instead.
   */
  get deployedBytecode(): Hex {
    return this.ensureCompiled().deployedBytecode;
  }

  get address(): Address {
    if (!this._address) {
      this._address = getContractAddress({
        bytecode: this.ensureCompiled().bytecode,
        from: CREATE2_FACTORY,
        opcode: "CREATE2",
        salt: CREATE2_SALT,
      });
    }
    return this._address;
  }

  /**
   * Convenience object for use with viem's `stateOverride` parameter.
   *
   * **Immutables caveat:** same as {@link deployedBytecode} — if the contract
   * declares `immutable` variables assigned in the constructor, the slots will
   * contain placeholder zeros and the override will not behave correctly.
   */
  get stateOverride(): { address: Address; code: Hex } {
    return { address: this.address, code: this.deployedBytecode };
  }

  bytecode(...args: unknown[]): Hex {
    const contract = this.ensureCompiled();
    if (args.length === 0) return contract.bytecode;

    const constructorAbi = contract.abi.find(
      (item): item is Extract<typeof item, { type: "constructor" }> => "type" in item && item.type === "constructor",
    );
    if (
      !constructorAbi ||
      !("inputs" in constructorAbi) ||
      !constructorAbi.inputs ||
      constructorAbi.inputs.length === 0
    ) {
      throw new Error(`Contract "${this._name}" does not have a constructor that accepts arguments`);
    }

    const encoded = encodeAbiParameters(constructorAbi.inputs, args);
    return `${contract.bytecode}${encoded.slice(2)}` as Hex;
  }
}
