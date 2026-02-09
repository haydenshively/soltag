import { describe, it, expect } from "vitest";
import { transformSolTemplates } from "../../src/build/unplugin.js";
import type { ContractTypeEntry } from "../../src/plugin/codegen.js";

describe("unplugin transform", () => {
  it("returns undefined for files without sol", () => {
    const result = transformSolTemplates("const x = 42;", "test.ts");
    expect(result).toBeUndefined();
  });

  it("replaces sol` ` with fromArtifacts call", () => {
    const input = `
import { sol } from 'soltag';
const contract = sol\`
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
    expect(result!.code).toContain("__SolContract.fromArtifacts(");
    expect(result!.code).not.toContain("sol`");
  });

  it("injects the __SolContract import at the top", () => {
    const input = `const contract = sol\`
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.24;
  contract A { function f() external pure returns (uint256) { return 1; } }
\`;`;
    const result = transformSolTemplates(input, "test.ts");

    expect(result).toBeDefined();
    expect(result!.code).toMatch(/^import \{ SolContract as __SolContract \} from "soltag";/);
  });

  it("includes ABI and bytecode in the replacement", () => {
    const input = `const c = sol\`
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
    // Should contain source hash
    expect(result!.code).toMatch(/"0x[0-9a-f]{64}"/);
  });

  it("handles multiple sol templates in one file", () => {
    const input = `
const a = sol\`
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.24;
  contract A { function fa() external pure returns (uint256) { return 1; } }
\`;
const b = sol\`
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
    const importCount = (result!.code.match(/import \{ SolContract as __SolContract \}/g) ?? []).length;
    expect(importCount).toBe(1);
  });

  it("produces a sourcemap", () => {
    const input = `const c = sol\`
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

  // --- Factory form tests ---

  it("transforms sol('Name')` ` with generic fromArtifacts", () => {
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
    expect(result!.code).toContain('__SolContract.fromArtifacts<"Greeter">(');
    expect(result!.code).not.toContain("sol(");
  });

  it("preserves plain sol` ` without generic parameter", () => {
    const input = `const contract = sol\`
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.24;
  contract A { function f() external pure returns (uint256) { return 1; } }
\`;`;
    const result = transformSolTemplates(input, "test.ts");

    expect(result).toBeDefined();
    expect(result!.code).toContain("__SolContract.fromArtifacts(");
    expect(result!.code).not.toContain("fromArtifacts<");
  });

  // --- Interpolation tests ---

  it("resolves const string interpolation at build time", () => {
    const input = `
const IERC20 = \`
  interface IERC20 {
    function balanceOf(address) external view returns (uint256);
  }
\`;
const contract = sol\`
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
    expect(result!.code).toContain("__SolContract.fromArtifacts(");
    expect(result!.code).toContain('"Lens"');
    expect(result!.code).toContain('"abi"');
  });

  it("resolves const string literal interpolation", () => {
    const input = `
const PRAGMA = "// SPDX-License-Identifier: MIT\\npragma solidity ^0.8.24;";
const contract = sol\`
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
const contract = sol\`
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
const contract = sol\`
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
    expect(entry.functions.length).toBeGreaterThan(0);
    expect(entry.functions[0].name).toBe("greet");
  });

  it("does not collect unnamed entries", () => {
    const entries = new Map<string, ContractTypeEntry>();
    const input = `const contract = sol\`
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.24;
  contract A { function f() external pure returns (uint256) { return 1; } }
\`;`;
    transformSolTemplates(input, "test.ts", entries);

    expect(entries.size).toBe(0);
  });
});
