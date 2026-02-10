import { describe, expect, it } from "vitest";

import { InlineContract, SolCompilationError, sol } from "../src/index.js";

describe("sol factory form", () => {
  it("returns a InlineContract via sol('Name')`...`", () => {
    const contract = sol("Greeter")`
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.24;
      contract Greeter {
        function greet() external pure returns (string memory) {
          return "hello";
        }
      }
    `;

    expect(contract).toBeInstanceOf(InlineContract);
  });

  it("exposes the contract name", () => {
    const contract = sol("Greeter")`
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.24;
      contract Greeter {
        function greet() external pure returns (string memory) {
          return "hello";
        }
      }
    `;

    expect(contract.name).toBe("Greeter");
  });

  it("exposes the named contract's ABI only", () => {
    const IERC20 = `
      interface IERC20 {
        function balanceOf(address) external view returns (uint256);
      }
    `;

    const contract = sol("Lens")`
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.24;
      ${IERC20}
      contract Lens {
        function getBalance(address token, address user) external view returns (uint256) {
          return IERC20(token).balanceOf(user);
        }
      }
    `;

    const abi = contract.abi;
    expect(abi).toBeInstanceOf(Array);
    // Only Lens's ABI (getBalance), not IERC20's balanceOf
    const fn = abi.find((item) => "name" in item && item.name === "getBalance");
    expect(fn).toBeDefined();
    const balanceOf = abi.find((item) => "name" in item && item.name === "balanceOf");
    expect(balanceOf).toBeUndefined();
  });

  it("exposes a deterministic CREATE2 address derived from bytecode", () => {
    const contract = sol("Greeter")`
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.24;
      contract Greeter {
        function greet() external pure returns (string memory) {
          return "hello";
        }
      }
    `;

    expect(contract.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // Same contract always produces the same address
    const contract2 = sol("Greeter")`
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.24;
      contract Greeter {
        function greet() external pure returns (string memory) {
          return "hello";
        }
      }
    `;
    expect(contract2.address).toBe(contract.address);
  });

  it("exposes deployedBytecode", () => {
    const contract = sol("Greeter")`
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.24;
      contract Greeter {
        function greet() external pure returns (string memory) {
          return "hello";
        }
      }
    `;

    expect(contract.deployedBytecode).toMatch(/^0x/);
  });

  it("exposes bytecode() for creation code", () => {
    const contract = sol("Greeter")`
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.24;
      contract Greeter {
        function greet() external pure returns (string memory) {
          return "hello";
        }
      }
    `;

    const bc = contract.bytecode();
    expect(bc).toMatch(/^0x/);
  });

  it("supports string interpolation for composing fragments", () => {
    const IERC20 = `
      interface IERC20 {
        function balanceOf(address) external view returns (uint256);
      }
    `;

    const contract = sol("Lens")`
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.24;
      ${IERC20}
      contract Lens {
        function getBalance(address token, address user) external view returns (uint256) {
          return IERC20(token).balanceOf(user);
        }
      }
    `;

    expect(contract).toBeInstanceOf(InlineContract);
    const abi = contract.abi;
    const fn = abi.find((item) => "name" in item && item.name === "getBalance");
    expect(fn).toBeDefined();
  });

  it("throws SolCompilationError for invalid Solidity", () => {
    const contract = sol("Bad")`
      pragma solidity ^0.8.24;
      contract Bad { invalid syntax here }
    `;

    expect(() => contract.abi).toThrow(SolCompilationError);
  });

  it("throws when named contract is not found in compilation result", () => {
    const contract = sol("NonExistent")`
      // SPDX-License-Identifier: MIT
      pragma solidity ^0.8.24;
      contract Greeter {
        function greet() external pure returns (string memory) {
          return "hello";
        }
      }
    `;

    expect(() => contract.abi).toThrow(/Contract "NonExistent" not found/);
  });
});
