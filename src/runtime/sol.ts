import { InlineContract } from "./contract.js";

/**
 * Factory for creating inline Solidity contracts with per-contract type narrowing.
 *
 * Usage:
 * ```ts
 * const lens = sol("Lens")`
 *   pragma solidity ^0.8.24;
 *   contract Lens {
 *     function getBalance(address token, address user) external view returns (uint256) {
 *       return IERC20(token).balanceOf(user);
 *     }
 *   }
 * `;
 *
 * lens.name;             // "Lens"
 * lens.address;          // deterministic address
 * lens.abi;              // Lens contract's ABI
 * lens.deployedBytecode; // runtime bytecode
 * lens.bytecode();       // creation bytecode
 * ```
 *
 * String interpolation is supported for composing Solidity from reusable fragments:
 * ```ts
 * const IERC20 = `
 *   interface IERC20 {
 *     function balanceOf(address) external view returns (uint256);
 *   }
 * `;
 *
 * const lens = sol("Lens")`
 *   ${IERC20}
 *   contract Lens { ... }
 * `;
 * ```
 */
export function sol<TName extends string>(name: TName) {
  return (strings: TemplateStringsArray, ...vals: string[]): InlineContract<TName> => {
    let source = strings[0];
    for (let i = 0; i < vals.length; i++) {
      source += vals[i] + strings[i + 1];
    }
    return new InlineContract(source, name);
  };
}
