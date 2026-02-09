import { SolContract } from "./contract.js";

/**
 * Tagged template literal for inline Solidity.
 *
 * Usage:
 * ```ts
 * const contract = sol`
 *   pragma solidity ^0.8.24;
 *   contract Greeter {
 *     function greet() external pure returns (string memory) {
 *       return "hello";
 *     }
 *   }
 * `;
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
 * const contract = sol`
 *   ${IERC20}
 *   contract Lens {
 *     function getBalance(address token, address user) external view returns (uint256) {
 *       return IERC20(token).balanceOf(user);
 *     }
 *   }
 * `;
 * ```
 */
export function sol(strings: TemplateStringsArray, ...values: string[]): SolContract {
  let source = strings[0];
  for (let i = 0; i < values.length; i++) {
    source += values[i] + strings[i + 1];
  }
  return new SolContract(source);
}
