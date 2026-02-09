# soltag

Inline Solidity in TypeScript. Write Solidity inside a tagged template literal, get real-time IDE type inference, and execute deployless reads via `eth_call` + `stateOverride`.

```ts
import { sol } from 'soltag';

const contract = sol`
  pragma solidity ^0.8.24;
  interface IERC20 { function balanceOf(address) external view returns (uint256); }
  library Lens {
    function userBalances(address[] memory tokens, address user)
      external view returns (uint256[] memory out)
    {
      out = new uint256[](tokens.length);
      for (uint256 i = 0; i < tokens.length; i++) {
        out[i] = IERC20(tokens[i]).balanceOf(user);
      }
    }
  }
`;

const balances = await contract.call(client, 'userBalances', [[USDC, WETH], user]);
//    ^? bigint[]                        ^? autocompletes    ^? typed args
```

## Features

- **`sol` tagged template** — write Solidity inline, get a `SolContract` you can `.call()` against any RPC. Supports string interpolation for composing reusable fragments
- **Real-time IDE support** — function name autocomplete, typed args, return type hover, inline Solidity diagnostics via a TypeScript Language Service Plugin (no codegen)
- **Build-time compilation** — bundler plugin (Vite, Rollup, esbuild, webpack) compiles Solidity at build time so `solc` (8MB WASM) never ships to production
- **Deployless execution** — uses `eth_call` with `stateOverride` to run contract code without deploying

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

Compiles `sol` templates at build time — `solc` is only needed during the build, not at runtime.

```ts
// vite.config.ts
import soltag from 'soltag/vite';

export default defineConfig({
  plugins: [soltag()],
});
```

Also available for other bundlers:

```ts
import soltag from 'soltag/rollup';
import soltag from 'soltag/esbuild';
import soltag from 'soltag/webpack';
```

### TypeScript Plugin (IDE support)

Add to your `tsconfig.json` for autocomplete, hover types, and inline Solidity diagnostics:

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
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const client = createPublicClient({ chain: mainnet, transport: http() });

const contract = sol`
  pragma solidity ^0.8.24;
  contract Math {
    function add(uint256 a, uint256 b) external pure returns (uint256) {
      return a + b;
    }
  }
`;

const result = await contract.call(client, 'add', [1n, 2n]);
// result === 3n
```

### Reading on-chain state

```ts
const contract = sol`
  pragma solidity ^0.8.24;
  interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function decimals() external view returns (uint8);
  }
  library Lens {
    function getBalance(address token, address user)
      external view returns (uint256 balance, uint8 decimals)
    {
      balance = IERC20(token).balanceOf(user);
      decimals = IERC20(token).decimals();
    }
  }
`;

const [balance, decimals] = await contract.call(client, 'getBalance', [USDC, user]);
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

const balanceLens = sol`
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

const allowanceLens = sol`
  pragma solidity ^0.8.24;
  ${IERC20}
  contract AllowanceLens {
    function getAllowance(address token, address owner, address spender)
      external view returns (uint256)
    {
      return IERC20(token).allowance(owner, spender);
    }
  }
`;
```

The bundler plugin resolves `const` string interpolations at build time, so these templates are still compiled ahead of time. Interpolations that can't be statically resolved (e.g. variables from function calls) are left for runtime compilation.

### Pre-compiled artifacts

For environments where you want full control over the compilation step:

```ts
import { SolContract } from 'soltag';

const contract = SolContract.fromArtifacts({
  MyContract: {
    abi: [/* ... */],
    deployedBytecode: '0x...',
    initBytecode: '0x...',
  },
});
```

## How It Works

### Runtime path (scripts, testing)

1. `sol` tag captures the Solidity source string
2. On first `.call()`, compiles with `solc-js` (lazy-loaded) and caches the result
3. Derives a deterministic address from the source hash
4. Executes via `eth_call` with `stateOverride` — the contract bytecode is injected at the derived address without deploying
5. Decodes the return value via viem's ABI decoder

### Build-time path (apps with bundler plugin)

1. The bundler plugin parses each file's AST to find `sol` tagged templates
2. For templates with interpolations, resolves `const` string values statically
3. Compiles the resolved Solidity with `solc-js` during the build
4. Replaces `` sol`...` `` with `SolContract.fromArtifacts({...})` containing the pre-compiled ABI and bytecode
5. At runtime, no compilation happens — only ABI encoding, `eth_call`, and decoding

### IDE path (TypeScript Language Service Plugin)

1. The TS plugin runs in `tsserver` (your editor's TypeScript process)
2. It finds `sol` tagged templates, compiles them with solc-js, and extracts the ABI
3. Provides function name completions for `.call()`, hover types showing Solidity-to-TypeScript mappings, and inline diagnostics for Solidity compilation errors

## API

### `sol`

```ts
function sol(strings: TemplateStringsArray, ...values: string[]): SolContract;
```

Tagged template literal. Accepts string interpolations for composing Solidity from reusable fragments.

### `SolContract`

```ts
class SolContract {
  // Create from pre-compiled artifacts (used by bundler plugin)
  static fromArtifacts(artifacts: CompilationResult, sourceHash?: Hex): SolContract;

  // Merged ABI across all contracts in the source
  readonly abi: Abi;

  // Execute a read-only call via stateOverride
  call(client: PublicClient, functionName: string, args?: readonly unknown[]): Promise<unknown>;
}
```

### `SolCompilationError`

Thrown when Solidity compilation fails. Contains a `.errors` array of `SolcDiagnostic` objects with severity, message, and source location.

## License

MIT
