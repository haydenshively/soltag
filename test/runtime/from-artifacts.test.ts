import { describe, expect, it } from "vitest";

import { compile } from "../../src/runtime/compiler.js";
import { InlineContract } from "../../src/runtime/contract.js";

const SOURCE = `
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.24;
  contract Greeter {
    function greet() external pure returns (string memory) {
      return "hello";
    }
  }
`;

describe("InlineContract.fromArtifacts", () => {
  it("creates a InlineContract from pre-compiled artifacts", () => {
    const artifacts = compile(SOURCE);
    const contract = InlineContract.fromArtifacts("Greeter", artifacts);

    expect(contract).toBeInstanceOf(InlineContract);
    expect(contract.name).toBe("Greeter");
    expect(contract.abi).toBeInstanceOf(Array);
    expect(contract.abi.length).toBeGreaterThan(0);
  });

  it("produces the same ABI as runtime-compiled version", () => {
    const artifacts = compile(SOURCE);
    const fromArtifacts = InlineContract.fromArtifacts("Greeter", artifacts);
    const fromSource = new InlineContract(SOURCE, "Greeter");

    expect(fromArtifacts.abi).toEqual(fromSource.abi);
  });

  it("derives a deterministic address from deployedBytecode", () => {
    const artifacts = compile(SOURCE);
    const contract = InlineContract.fromArtifacts("Greeter", artifacts);

    expect(contract.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // Same artifacts always produce the same address
    const contract2 = InlineContract.fromArtifacts("Greeter", compile(SOURCE));
    expect(contract2.address).toBe(contract.address);
  });

  it("does not require solc when using fromArtifacts", () => {
    // fromArtifacts with pre-built data should never touch solc
    const artifacts = compile(SOURCE);
    const contract = InlineContract.fromArtifacts("Greeter", artifacts);

    // Accessing .abi should use the pre-compiled data, not trigger compile()
    expect(contract.abi).toEqual(artifacts.Greeter.abi);
  });

  it("exposes deployedBytecode", () => {
    const artifacts = compile(SOURCE);
    const contract = InlineContract.fromArtifacts("Greeter", artifacts);

    expect(contract.deployedBytecode).toMatch(/^0x/);
    expect(contract.deployedBytecode).toBe(artifacts.Greeter.deployedBytecode);
  });

  it("exposes bytecode()", () => {
    const artifacts = compile(SOURCE);
    const contract = InlineContract.fromArtifacts("Greeter", artifacts);

    const bc = contract.bytecode();
    expect(bc).toMatch(/^0x/);
    expect(bc).toBe(artifacts.Greeter.bytecode);
  });

  it("throws when named contract is not found in artifacts", () => {
    const artifacts = compile(SOURCE);
    const contract = InlineContract.fromArtifacts("NonExistent", artifacts);

    expect(() => contract.abi).toThrow(/Contract "NonExistent" not found/);
  });
});
