# soltag

Inline Solidity in TypeScript. Write Solidity inside a tagged template literal, get a data object with typed `abi`, `bytecode()`, `deployedBytecode`, and a deterministic `address`.

```ts
import { sol } from 'soltag';

const lens = sol("Lens")`
  pragma solidity ^0.8.24;
  interface IERC20 { function balanceOf(address) external view returns (uint256); }
  contract Lens {
    function getBalance(address token, address user)
      external view returns (uint256)
    {
      return IERC20(token).balanceOf(user);
    }
  }
`;

lens.name;             // "Lens" (typed as literal)
lens.abi;              // precise, as-const ABI (via generated .d.ts)
lens.address;          // `0x${string}` (deterministic, derived from deployedBytecode)
lens.deployedBytecode; // `0x${string}` (runtime bytecode)
lens.bytecode();       // `0x${string}` (creation bytecode)
```

## Features

- **`sol("Name")` tagged template** — write Solidity inline, get a `InlineContract` with typed ABI, bytecode, and a deterministic address. Supports string interpolation for composing reusable fragments
- **Real-time IDE support** — inline Solidity diagnostics and contract-name validation via a TypeScript Language Service Plugin. ABI and `bytecode()` types are provided through generated `.d.ts` augmentation
- **Build-time compilation** — bundler plugin (Vite, Rollup, esbuild, webpack) compiles Solidity at build time so `solc` (8MB WASM) never ships to production
- **Data-oriented** — `InlineContract` is a plain data container. Use `abi` and `bytecode` with whatever execution library you prefer (viem, ethers, etc.)

## Install

```sh
pnpm add soltag viem solc
```

> **Note on `pragma solidity`:** The pragma in your Solidity source is a compatibility constraint checked by solc at compile time — it doesn't select a compiler version. As long as your installed `solc` version satisfies the pragma range (e.g. solc 0.8.28 satisfies `^0.8.24`), compilation proceeds. If it doesn't, solc will reject it with an error.

## Setup

### Bundler Plugin (recommended for apps)

Compiles `sol("Name")` templates at build time — `solc` is only needed during the build, not at runtime.

```ts
// vite.config.ts
import soltag from 'soltag/vite';

export default defineConfig({
  plugins: [
    soltag({
      solc: {
        optimizer: { enabled: true, runs: 200 }
      }
    })
  ],
});
```

Also available for other bundlers:

```ts
import soltag from 'soltag/rollup';
import soltag from 'soltag/esbuild';
import soltag from 'soltag/webpack';
```

### TypeScript Plugin (IDE support)

Add to your `tsconfig.json` for inline Solidity diagnostics and contract-name validation:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "soltag/plugin" }]
  }
}
```

> VS Code users: make sure your workspace is using the TypeScript version from `node_modules` (not the built-in one). Open a `.ts` file, click the TypeScript version in the bottom status bar, and select "Use Workspace Version".

### Syntax Highlighting (VS Code)

For Solidity syntax highlighting inside `sol` template literals, install [soltag-highlighter](https://marketplace.visualstudio.com/items?itemName=haydenshively.soltag-highlighter).

## Usage

### Basic

```ts
import { sol } from 'soltag';

const math = sol("Math")`
  pragma solidity ^0.8.24;
  contract Math {
    function add(uint256 a, uint256 b) external pure returns (uint256) {
      return a + b;
    }
  }
`;

math.name;             // "Math"
math.abi;              // readonly [{ type: "function", name: "add", ... }]
math.bytecode();       // creation bytecode
math.deployedBytecode; // runtime bytecode
math.address;          // deterministic address derived from deployedBytecode
```

### Constructor arguments

For contracts with constructors, `bytecode()` accepts typed arguments:

```ts
const token = sol("MyToken")`
  pragma solidity ^0.8.24;
  contract MyToken {
    uint256 public supply;
    constructor(uint256 _supply) {
      supply = _supply;
    }
  }
`;

token.bytecode(1000n); // creation bytecode + ABI-encoded constructor args
```

### Using with viem

`InlineContract` is a data container — use its properties with any execution library. Here are examples using viem.

#### Deployless read via `stateOverride`

Inject an undeployed contract's code at its deterministic address to read on-chain state without deploying:

```ts
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { sol } from 'soltag';

const client = createPublicClient({ chain: mainnet, transport: http() });

const IERC20 = `
  interface IERC20 {
    function balanceOf(address) external view returns (uint256);
  }
`;

const lens = sol("BalanceLens")`
  pragma solidity ^0.8.24;
  ${IERC20}
  contract BalanceLens {
    function getBalance(address token, address user)
      external view returns (uint256)
    {
      return IERC20(token).balanceOf(user);
    }
  }
`;

// NOTE: Works with multicall!
const balance = await client.readContract({
  address: lens.address,
  abi: lens.abi,
  functionName: 'getBalance',
  args: [USDC, userAddress],
  stateOverride: [lens.stateOverride],
});
```

#### Deployless read with constructor args

For contracts that use `immutable` variables (assigned in the constructor), use viem's `factory` and `factoryData` instead of `stateOverride` (see [Immutables Caveat](#immutables-caveat)):

```ts
import { sol, CREATE2_FACTORY } from 'soltag';

const lens = sol("Aggregator")`
  pragma solidity ^0.8.24;
  contract Aggregator {
    uint256 public immutable threshold;
    constructor(uint256 _threshold) {
      threshold = _threshold;
    }
    function check(uint256 value) external view returns (bool) {
      return value >= threshold;
    }
  }
`;

// NOTE: Multicall won't work this way.
const result = await client.readContract({
  address: lens.address,
  abi: lens.abi,
  functionName: 'check',
  args: [100n],
  factory: CREATE2_FACTORY,
  factoryData: lens.bytecode(50n),
});
```

#### Overriding an existing contract

Inject replacement code at an existing deployed contract's address — useful for adding or modifying view functions:

```ts
const mockToken = sol("MockToken")`
  pragma solidity ^0.8.24;
  contract MockToken {
    function balanceOf(address) external pure returns (uint256) {
      return 1_000_000e18;
    }
  }
`;

const balance = await client.readContract({
  address: USDC,
  abi: mockToken.abi,
  functionName: 'balanceOf',
  args: [userAddress],
  stateOverride: [{
    address: USDC,
    code: mockToken.deployedBytecode,
  }],
});
```

### Composing with fragments

The `sol` tag supports string interpolation, so you can define reusable Solidity fragments and compose them:

```ts
const IERC20 = `
  interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function decimals() external view returns (uint8);
  }
`;

const balanceLens = sol("BalanceLens")`
  pragma solidity ^0.8.24;
  ${IERC20}
  contract BalanceLens {
    function getBalance(address token, address user)
      external view returns (uint256 balance, uint8 decimals)
    {
      balance = IERC20(token).balanceOf(user);
      decimals = IERC20(token).decimals();
    }
  }
`;
```

The bundler plugin resolves `const` string interpolations at build time, so these templates are still compiled ahead of time. Interpolations that can't be statically resolved (e.g. variables from function calls) will cause a build error — extract the dynamic part into a separate contract or make it a `const`.

## How It Works

### Bundler plugin

1. The bundler plugin parses each file's AST to find `sol("Name")` tagged templates
2. For templates with interpolations, resolves `const` string values statically
3. Compiles the resolved Solidity with `solc-js` during the build
4. Replaces `` sol("Name")`...` `` with `new InlineContract("Name", {...})` containing the pre-compiled ABI and bytecode
5. At runtime, no compilation happens — property access returns pre-compiled data directly

### TypeScript Language Service Plugin

1. The TS plugin runs in `tsserver` (your editor's TypeScript process)
2. It finds `sol("Name")` tagged templates, compiles them with solc-js, and extracts the ABI
3. Generates `.soltag/types.d.ts` with module augmentation that narrows `abi` to precise "as const" types and adds typed `bytecode()` overloads per contract
4. Reports inline Solidity compilation errors and warns if the contract name doesn't match any contract in the source

## Immutables Caveat

Solidity `immutable` variables are assigned in the constructor and baked into the runtime bytecode during deployment. The `deployedBytecode` returned by solc (and exposed by `InlineContract`) contains **placeholder zeros** in immutable slots — the real values are only filled in when the constructor actually runs on-chain.

This means **`deployedBytecode` is unsuitable for `stateOverride` injection** when the contract uses immutable variables. The zeroed slots will cause the contract to behave incorrectly.

If your contract uses immutables, deploy it normally using `bytecode(…constructorArgs)` instead of injecting `deployedBytecode` via `stateOverride`. Note that `bytecode()` returns _creation_ bytecode (the code that runs the constructor and returns the final runtime code), not runtime bytecode with constructor args spliced in — there is no way to produce correct runtime bytecode with immutables without actually executing the constructor.

## API

### `sol`

```ts
function sol<TName extends string>(name: TName):
  (strings: TemplateStringsArray, ...values: string[]) => InlineContract<TName>;
```

Factory that returns a tagged template function. The `name` must match a contract in the Solidity source. The bundler plugin transforms `sol("Name")` calls at build time — `sol` itself never executes at runtime.

### `InlineContract<TName>`

```ts
class InlineContract<TName extends string = string> {
  // The contract name (typed as a string literal)
  get name(): TName;

  // The contract's ABI (narrowed to precise type via generated .d.ts)
  get abi(): Abi;

  // Runtime bytecode as emitted by solc (see Immutables Caveat)
  get deployedBytecode(): Hex;

  // Deterministic address derived from CREATE2(bytecode)
  get address(): Address;

  // Convenience object for viem's stateOverride parameter
  get stateOverride(): { address: Address; code: Hex };

  // Creation bytecode, optionally with ABI-encoded constructor args appended
  bytecode(...args: unknown[]): Hex;
}
```
