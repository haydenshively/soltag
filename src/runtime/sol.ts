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
 *
 * Factory form enables per-contract type narrowing:
 * ```ts
 * const lens = sol("Lens")`
 *   pragma solidity ^0.8.24;
 *   contract Lens {
 *     function add(uint256 a, uint256 b) external pure returns (uint256) { return a + b; }
 *   }
 * `;
 * lens.call(client, 'add', [0n, 0n]); // → Promise<bigint>
 * ```
 */
export function sol(strings: TemplateStringsArray, ...values: string[]): SolContract;
export function sol<TName extends string>(
  name: TName,
): (strings: TemplateStringsArray, ...values: string[]) => SolContract<TName>;
export function sol(stringsOrName: TemplateStringsArray | string, ...values: string[]) {
  if (typeof stringsOrName === "object" && "raw" in stringsOrName) {
    // Tagged template: sol`...`
    let source = stringsOrName[0];
    for (let i = 0; i < values.length; i++) {
      source += values[i] + stringsOrName[i + 1];
    }
    return new SolContract(source);
  }
  // Factory: sol("Name") returns tag function
  return (strings: TemplateStringsArray, ...vals: string[]) => {
    let source = strings[0];
    for (let i = 0; i < vals.length; i++) {
      source += vals[i] + strings[i + 1];
    }
    return new SolContract(source);
  };
}
