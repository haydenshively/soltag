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
pnpm add soltag viem
```

For **runtime compilation** (scripts, REPLs, testing), also install `solc`:

```sh
pnpm add solc
```

For the **bundler plugin** (recommended for apps), install `solc` as a dev dependency along with `unplugin` and `magic-string`:

```sh
pnpm add -D solc unplugin magic-string
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

`InlineContract` is a data container — use its properties with any execution library. Here's an example with viem's `eth_call` + `stateOverride` for deployless reads:

```ts
import { createPublicClient, http, decodeFunctionResult, encodeFunctionData } from 'viem';
import { mainnet } from 'viem/chains';
import { sol } from 'soltag';

const client = createPublicClient({ chain: mainnet, transport: http() });

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

const data = encodeFunctionData({
  abi: lens.abi,
  functionName: 'getBalance',
  args: [USDC, user],
});

const result = await client.call({
  to: lens.address,
  data,
  stateOverrides: [{
    address: lens.address,
    code: lens.deployedBytecode,
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

The bundler plugin resolves `const` string interpolations at build time, so these templates are still compiled ahead of time. Interpolations that can't be statically resolved (e.g. variables from function calls) are left for runtime compilation.

### Pre-compiled artifacts

For environments where you want full control over the compilation step:

```ts
import { InlineContract } from 'soltag';

const contract = InlineContract.fromArtifacts("MyContract", {
  MyContract: {
    abi: [/* ... */],
    deployedBytecode: '0x...',
    bytecode: '0x...',
  },
});
```

## How It Works

### Runtime path (scripts, testing)

1. `sol("Name")` captures the Solidity source string and contract name
2. On first property access, compiles with `solc-js` (lazy-loaded) and caches the result
3. Exposes `abi`, `bytecode()`, and `deployedBytecode` for the named contract
4. Derives a deterministic `address` from `keccak256(deployedBytecode)`

### Build-time path (apps with bundler plugin)

1. The bundler plugin parses each file's AST to find `sol("Name")` tagged templates
2. For templates with interpolations, resolves `const` string values statically
3. Compiles the resolved Solidity with `solc-js` during the build
4. Replaces `` sol("Name")`...` `` with `InlineContract.fromArtifacts("Name", {...})` containing the pre-compiled ABI and bytecode
5. At runtime, no compilation happens — property access returns pre-compiled data directly

### IDE path (TypeScript Language Service Plugin)

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

Factory that returns a tagged template function. The `name` must match a contract in the Solidity source.

### `InlineContract<TName>`

```ts
class InlineContract<TName extends string = string> {
  // Create from pre-compiled artifacts (used by bundler plugin)
  static fromArtifacts<T extends string>(name: T, artifacts: CompilationResult): InlineContract<T>;

  // The contract name (typed as a string literal)
  get name(): TName;

  // The contract's ABI (narrowed to precise type via generated .d.ts)
  get abi(): Abi;

  // Runtime bytecode as emitted by solc (see Immutables Caveat)
  get deployedBytecode(): Hex;

  // Deterministic address derived from keccak256(deployedBytecode)
  get address(): Hex;

  // Creation bytecode, optionally with ABI-encoded constructor args appended
  bytecode(...args: unknown[]): Hex;
}
```

### `SolCompilationError`

Thrown when Solidity compilation fails. Contains a `.errors` array of `SolcDiagnostic` objects with severity, message, and source location.

## License

MIT
