import { type Abi, type Address, encodeAbiParameters, getContractAddress, type Hex, zeroAddress } from "viem";

export interface CompiledContract {
  abi: Abi;
  /** Runtime bytecode (what lives at the contract address). Used with stateOverride. */
  deployedBytecode: Hex;
  /** Init bytecode (constructor + deployment code). Used for actual deployment. */
  bytecode: Hex;
}

export type CompilationResult = Record<string, CompiledContract>;

export const CREATE2_FACTORY: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
export const CREATE2_SALT: Hex = `${zeroAddress}51A1E51A1E51A1E51A1E51A1`;

/**
 * Augment this interface via module augmentation to narrow the `abi` getter
 * for specific contract names. The generated `.soltag/types.d.ts` does this
 * automatically.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by generated .d.ts
export interface InlineContractAbiMap {}

// biome-ignore lint/suspicious/noEmptyInterface: augmented by generated .d.ts
export interface InlineContractConstructorArgsMap {}

/**
 * Tag factory for inline Solidity templates. Write `sol("Name")\`...\`` to
 * define a contract. The bundler plugin compiles the Solidity at build time
 * and replaces the expression with a pre-compiled {@link InlineContract}.
 *
 * This function is never intended to execute at runtime — the bundler plugin
 * transforms it away. If it does execute, it throws an error indicating that
 * the plugin is missing.
 */
export function sol<TName extends string>(
  _name: TName,
): (strings: TemplateStringsArray, ...values: string[]) => InlineContract<TName> {
  throw new Error(
    "soltag: sol() was not transformed by the bundler plugin. " +
      "Add soltag/vite (or the plugin for your bundler) to your build config.",
  );
}

export class InlineContract<TName extends string = string> {
  private _name: TName;
  private _contract: CompiledContract;
  private _address: Address | undefined;

  constructor(name: TName, artifacts: CompilationResult) {
    this._name = name;
    const contract = artifacts[name];
    if (!contract) {
      const available = Object.keys(artifacts).join(", ");
      throw new Error(`Contract "${name}" not found in compilation result. Available contracts: ${available}`);
    }
    this._contract = contract;
  }

  get name(): TName {
    return this._name;
  }

  get abi(): TName extends keyof InlineContractAbiMap ? InlineContractAbiMap[TName] : Abi {
    return this._contract.abi as TName extends keyof InlineContractAbiMap ? InlineContractAbiMap[TName] : Abi;
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
    return this._contract.deployedBytecode;
  }

  get address(): Address {
    if (!this._address) {
      this._address = getContractAddress({
        bytecode: this._contract.bytecode,
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

  bytecode(
    ...args: TName extends keyof InlineContractConstructorArgsMap ? InlineContractConstructorArgsMap[TName] : unknown[]
  ): Hex {
    if (args.length === 0) return this._contract.bytecode;

    const constructorAbi = this._contract.abi.find(
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
    return `${this._contract.bytecode}${encoded.slice(2)}` as Hex;
  }
}
