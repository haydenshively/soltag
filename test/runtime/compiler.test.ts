import { describe, it, expect } from "vitest";
import { compile, hashSource, SolCompilationError } from "../../src/runtime/compiler.js";

describe("compiler", () => {
  it("compiles a simple contract", () => {
    const result = compile(`
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.24;
      contract Greeter {
        function greet() external pure returns (string memory) {
          return "hello";
        }
      }
    `);

    expect(result).toHaveProperty("Greeter");
    expect(result.Greeter.abi).toBeInstanceOf(Array);
    expect(result.Greeter.abi.length).toBeGreaterThan(0);
    expect(result.Greeter.deployedBytecode).toMatch(/^0x/);
    expect(result.Greeter.initBytecode).toMatch(/^0x/);
  });

  it("compiles a library", () => {
    const result = compile(`
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.24;
      library Math {
        function add(uint256 a, uint256 b) external pure returns (uint256) {
          return a + b;
        }
      }
    `);

    expect(result).toHaveProperty("Math");
    const addFn = result.Math.abi.find((item: Record<string, unknown>) => item.name === "add");
    expect(addFn).toBeDefined();
  });

  it("compiles multiple contracts", () => {
    const result = compile(`
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.24;
      interface IERC20 {
        function balanceOf(address) external view returns (uint256);
      }
      library Lens {
        function getBalance(address token, address user) external view returns (uint256) {
          return IERC20(token).balanceOf(user);
        }
      }
    `);

    expect(result).toHaveProperty("IERC20");
    expect(result).toHaveProperty("Lens");
  });

  it("throws SolCompilationError on invalid source", () => {
    expect(() =>
      compile(`
        pragma solidity ^0.8.24;
        contract Bad {
          function broken() {
            this is not valid solidity;
          }
        }
      `),
    ).toThrow(SolCompilationError);
  });

  it("returns cached result on second call", () => {
    const source = `
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.24;
      contract Cached {
        function value() external pure returns (uint256) { return 42; }
      }
    `;

    const first = compile(source);
    const second = compile(source);
    expect(first).toBe(second); // Same reference = cached
  });

  it("hashSource returns hex string", () => {
    const hash = hashSource("hello");
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
