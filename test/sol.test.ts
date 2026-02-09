import { describe, expect, it } from "vitest";

import { SolCompilationError, SolContract, sol } from "../src/index.js";

describe("sol tagged template", () => {
  it("returns a SolContract", () => {
    const contract = sol`
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.24;
      contract Greeter {
        function greet() external pure returns (string memory) {
          return "hello";
        }
      }
    `;

    expect(contract).toBeInstanceOf(SolContract);
  });

  it("exposes merged ABI from all contracts", () => {
    const contract = sol`
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.24;
      library Math {
        function add(uint256 a, uint256 b) external pure returns (uint256) {
          return a + b;
        }
        function sub(uint256 a, uint256 b) external pure returns (uint256) {
          return a - b;
        }
      }
    `;

    const abi = contract.abi;
    expect(abi).toBeInstanceOf(Array);
    expect(abi.length).toBe(2); // add and sub
  });

  it("supports string interpolation for composing fragments", () => {
    const IERC20 = `
      interface IERC20 {
        function balanceOf(address) external view returns (uint256);
      }
    `;

    const contract = sol`
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.24;
      ${IERC20}
      contract Lens {
        function getBalance(address token, address user) external view returns (uint256) {
          return IERC20(token).balanceOf(user);
        }
      }
    `;

    expect(contract).toBeInstanceOf(SolContract);
    const abi = contract.abi;
    expect(abi).toBeInstanceOf(Array);
    const fn = abi.find((item) => "name" in item && item.name === "getBalance");
    expect(fn).toBeDefined();
  });

  it("throws SolCompilationError for invalid Solidity", () => {
    const contract = sol`
      pragma solidity ^0.8.24;
      contract Bad { invalid syntax here }
    `;

    expect(() => contract.abi).toThrow(SolCompilationError);
  });
});

describe("sol factory form", () => {
  it("returns a SolContract via sol('Name')`...`", () => {
    const contract = sol("Greeter")`
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.24;
      contract Greeter {
        function greet() external pure returns (string memory) {
          return "hello";
        }
      }
    `;

    expect(contract).toBeInstanceOf(SolContract);
  });

  it("exposes ABI from factory form", () => {
    const contract = sol("Math")`
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.24;
      library Math {
        function add(uint256 a, uint256 b) external pure returns (uint256) {
          return a + b;
        }
      }
    `;

    const abi = contract.abi;
    expect(abi).toBeInstanceOf(Array);
    expect(abi.length).toBe(1);
  });
});
