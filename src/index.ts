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
 * Spreadable descriptor returned by {@link InlineContract.with}. The keys
 * match viem's deployless-via-factory parameters (`abi`, `address`, `factory`,
 * `factoryData`), so callers can spread the object straight into
 * `readContract` / `simulateContract`:
 *
 * ```ts
 * await readContract(client, {
 *   functionName: 'query',
 *   args: [ids],
 *   ...lens.with(morpho, irm),
 * });
 * ```
 */
export interface DeploylessCall<TAbi = Abi> {
  abi: TAbi;
  address: Address;
  factory: Address;
  factoryData: Hex;
}

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

export interface SolFileOptions {
  /** Skip the default leading SPDX/pragma strip. */
  raw?: boolean;
}

/**
 * Build-time helper for splicing the contents of a `.sol` file into a
 * `sol("Name")\`...\`` template. The bundler plugin reads the file at build
 * time and replaces the call with its contents (with the leading SPDX +
 * pragma block stripped by default — set `{ raw: true }` to preserve it).
 *
 * Relative and absolute paths are resolved against the `.ts` file's directory.
 * Bare specifiers (e.g. `@repo/contracts/solidity/Foo.sol`) go through Node's
 * package resolver, so workspace packages that expose `.sol` files via their
 * `exports` map work the same way as a normal TypeScript import.
 *
 * ```ts
 * const lens = sol("Lens")`
 *   pragma solidity ^0.8.24;
 *   ${solFile("./contracts/IERC20.sol")}
 *   ${solFile("@repo/contracts/solidity/IVault.sol")}
 *   contract Lens { ... }
 * `;
 * ```
 *
 * For transitive imports (e.g. a contract that imports OpenZeppelin), run
 * `forge flatten` as a codegen step in `package.json`, commit the output,
 * and reference the flat file with `solFile`. That keeps build environments
 * (Vercel, Netlify, etc.) free of Solidity-specific tooling.
 *
 * Like {@link sol}, this never executes at runtime — if it does, the plugin
 * is missing.
 */
export function solFile(_path: string, _opts?: SolFileOptions): string {
  throw new Error(
    "soltag: solFile() was not transformed by the bundler plugin. " +
      "Add soltag/vite (or the plugin for your bundler) to your build config.",
  );
}

export class InlineContract<TName extends string = string> {
  private _name: TName;
  private _contract: CompiledContract;

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
   * behavior. In those cases, use {@link with} to deploy the contract via
   * the canonical CREATE2 factory instead.
   */
  get deployedBytecode(): Hex {
    return this._contract.deployedBytecode;
  }

  /**
   * Convenience object for use with viem's `stateOverride` parameter. The
   * address is the deterministic CREATE2 address for the **no-args** creation
   * bytecode, which is the only case where a `stateOverride` injection is
   * meaningful — contracts that take constructor args rely on
   * `deployedBytecode`, which solc emits with placeholder zeros in immutable
   * slots (see the immutables caveat on {@link deployedBytecode}). Use
   * {@link with} for those.
   */
  get stateOverride(): { address: Address; code: Hex } {
    return {
      address: computeCreate2Address(this._contract.bytecode),
      code: this._contract.deployedBytecode,
    };
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

  /**
   * Descriptor for a deployless read via the canonical CREATE2 factory, with
   * constructor arguments narrowly typed through
   * {@link InlineContractConstructorArgsMap}. Returns an object whose keys
   * match viem's `{ abi, address, factory, factoryData }` so it can be spread
   * straight into `readContract`:
   *
   * ```ts
   * await readContract(client, {
   *   functionName: 'query',
   *   args: [ids],
   *   ...lens.with(morpho, irm),
   * });
   * ```
   *
   * The address returned here is the deterministic CREATE2 address derived
   * from the creation bytecode **with the encoded args appended**, so it is
   * correct for contracts with a non-empty constructor (unlike
   * `stateOverride.address`, which uses the no-args creation bytecode and is
   * only meaningful for contracts that don't take constructor args).
   */
  with(
    ...args: TName extends keyof InlineContractConstructorArgsMap ? InlineContractConstructorArgsMap[TName] : unknown[]
  ): DeploylessCall<TName extends keyof InlineContractAbiMap ? InlineContractAbiMap[TName] : Abi> {
    const initcode = this.bytecode(...(args as Parameters<InlineContract<TName>["bytecode"]>));
    return {
      abi: this._contract.abi as TName extends keyof InlineContractAbiMap ? InlineContractAbiMap[TName] : Abi,
      address: computeCreate2Address(initcode),
      factory: CREATE2_FACTORY,
      factoryData: `${CREATE2_SALT}${initcode.slice(2)}` as Hex,
    };
  }
}

function computeCreate2Address(initcode: Hex): Address {
  return getContractAddress({
    bytecode: initcode,
    from: CREATE2_FACTORY,
    opcode: "CREATE2",
    salt: CREATE2_SALT,
  });
}
