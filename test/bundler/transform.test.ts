import { describe, expect, it } from "vitest";

import { transformSolTemplates } from "../../src/bundler/unplugin.js";
import type { ContractTypeEntry } from "../../src/codegen.js";

describe("unplugin transform", () => {
  it("returns undefined for files without sol(", () => {
    const result = transformSolTemplates("const x = 42;", "test.ts");
    expect(result).toBeUndefined();
  });

  it("returns undefined for plain sol`` (not supported)", () => {
    const input = `const contract = sol\`
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.24;
  contract A { function f() external pure returns (uint256) { return 1; } }
\`;`;
    const result = transformSolTemplates(input, "test.ts");
    expect(result).toBeUndefined();
  });

  it("transforms sol('Name')` ` with InlineContract constructor call", () => {
    const input = `
import { sol } from 'soltag';
const contract = sol("Greeter")\`
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.24;
  contract Greeter {
    function greet() external pure returns (string memory) {
      return "hello";
    }
  }
\`;
`;
    const result = transformSolTemplates(input, "test.ts");

    expect(result).toBeDefined();
    expect(result!.code).toContain('new __InlineContract("Greeter",');
    expect(result!.code).not.toContain("sol(");
  });

  it("injects the __InlineContract import at the top", () => {
    const input = `const contract = sol("A")\`
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.24;
  contract A { function f() external pure returns (uint256) { return 1; } }
\`;`;
    const result = transformSolTemplates(input, "test.ts");

    expect(result).toBeDefined();
    expect(result!.code).toMatch(/^import \{ InlineContract as __InlineContract \} from "soltag";/);
  });

  it("includes ABI and bytecode in the replacement", () => {
    const input = `const c = sol("Greeter")\`
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.24;
  contract Greeter {
    function greet() external pure returns (string memory) {
      return "hello";
    }
  }
\`;`;
    const result = transformSolTemplates(input, "test.ts");

    expect(result).toBeDefined();
    // Should contain the contract name as a key in the artifacts
    expect(result!.code).toContain('"Greeter"');
    // Should contain ABI
    expect(result!.code).toContain('"abi"');
    // Should contain deployed bytecode
    expect(result!.code).toContain('"deployedBytecode"');
  });

  it("handles multiple sol('Name') templates in one file", () => {
    const input = `
const a = sol("A")\`
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.24;
  contract A { function fa() external pure returns (uint256) { return 1; } }
\`;
const b = sol("B")\`
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.24;
  contract B { function fb() external pure returns (uint256) { return 2; } }
\`;
`;
    const result = transformSolTemplates(input, "test.ts");

    expect(result).toBeDefined();
    expect(result!.code).toContain('"A"');
    expect(result!.code).toContain('"B"');
    // Only one import should be injected
    const importCount = (result!.code.match(/import \{ InlineContract as __InlineContract \}/g) ?? []).length;
    expect(importCount).toBe(1);
  });

  it("produces a sourcemap", () => {
    const input = `const c = sol("A")\`
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.24;
  contract A { function f() external pure returns (uint256) { return 1; } }
\`;`;
    const result = transformSolTemplates(input, "test.ts");

    expect(result).toBeDefined();
    expect(result!.map).toBeDefined();
    expect(result!.map.sources).toContain("test.ts");
  });

  it("does not match sol in other contexts like parasol", () => {
    // parasol is a different identifier, AST won't match it
    const input = `const x = parasol\`template\`;`;
    const result = transformSolTemplates(input, "test.ts");
    expect(result).toBeUndefined();
  });

  // --- Interpolation tests ---

  it("resolves const string interpolation at build time", () => {
    const input = `
const IERC20 = \`
  interface IERC20 {
    function balanceOf(address) external view returns (uint256);
  }
\`;
const contract = sol("Lens")\`
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.24;
  \${IERC20}
  contract Lens {
    function getBalance(address token, address user) external view returns (uint256) {
      return IERC20(token).balanceOf(user);
    }
  }
\`;
`;
    const result = transformSolTemplates(input, "test.ts");

    expect(result).toBeDefined();
    expect(result!.code).toContain("new __InlineContract(");
    expect(result!.code).toContain('"Lens"');
    expect(result!.code).toContain('"abi"');
  });

  it("resolves const string literal interpolation", () => {
    const input = `
const PRAGMA = "// SPDX-License-Identifier: MIT\\npragma solidity ^0.8.24;";
const contract = sol("Simple")\`
  \${PRAGMA}
  contract Simple { function f() external pure returns (uint256) { return 1; } }
\`;
`;
    const result = transformSolTemplates(input, "test.ts");

    expect(result).toBeDefined();
    expect(result!.code).toContain('"Simple"');
  });

  it("skips templates with unresolvable interpolations", () => {
    const input = `
let dynamicSource = getSolidity();
const contract = sol("X")\`
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.24;
  \${dynamicSource}
  contract X { function f() external pure returns (uint256) { return 1; } }
\`;
`;
    const result = transformSolTemplates(input, "test.ts");

    // Should return undefined since the only sol template couldn't be resolved
    expect(result).toBeUndefined();
  });

  it("skips non-const variable interpolations", () => {
    const input = `
let mutableSource = "interface I {}";
const contract = sol("X")\`
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.24;
  \${mutableSource}
  contract X { function f() external pure returns (uint256) { return 1; } }
\`;
`;
    const result = transformSolTemplates(input, "test.ts");

    // let is not const, so it can't be resolved at build time
    expect(result).toBeUndefined();
  });

  // --- Entry collection for .d.ts generation ---

  it("collects named entries when namedEntries map is provided", () => {
    const entries = new Map<string, ContractTypeEntry>();
    const input = `
const contract = sol("Greeter")\`
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.24;
  contract Greeter {
    function greet() external pure returns (string memory) {
      return "hello";
    }
  }
\`;
`;
    transformSolTemplates(input, "test.ts", entries);

    expect(entries.size).toBe(1);
    const entry = Array.from(entries.values())[0];
    expect(entry.contractName).toBe("Greeter");
    // Greeter has no constructor, so constructorInputs should be empty
    expect(entry.constructorInputs).toHaveLength(0);
    // ABI should be collected
    expect(entry.abi).toBeInstanceOf(Array);
    expect(entry.abi.length).toBeGreaterThan(0);
  });

  it("collects constructor inputs for contracts with constructors", () => {
    const entries = new Map<string, ContractTypeEntry>();
    const input = `
const contract = sol("MyToken")\`
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.24;
  contract MyToken {
    uint256 public supply;
    constructor(uint256 _supply) {
      supply = _supply;
    }
  }
\`;
`;
    transformSolTemplates(input, "test.ts", entries);

    expect(entries.size).toBe(1);
    const entry = Array.from(entries.values())[0];
    expect(entry.contractName).toBe("MyToken");
    expect(entry.constructorInputs).toHaveLength(1);
    expect(entry.constructorInputs[0].type).toBe("uint256");
  });
});
