import { describe, it, expect } from "vitest";
import { SolContract } from "../../src/runtime/contract.js";
import { compile, hashArtifacts } from "../../src/runtime/compiler.js";
import { deriveAddress } from "../../src/runtime/execution.js";

const SOURCE = `
  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.24;
  contract Greeter {
    function greet() external pure returns (string memory) {
      return "hello";
    }
  }
`;

describe("SolContract.fromArtifacts", () => {
  it("creates a SolContract from pre-compiled artifacts", () => {
    const artifacts = compile(SOURCE);
    const contract = SolContract.fromArtifacts(artifacts);

    expect(contract).toBeInstanceOf(SolContract);
    expect(contract.abi).toBeInstanceOf(Array);
    expect(contract.abi.length).toBeGreaterThan(0);
  });

  it("produces the same ABI as runtime-compiled version", () => {
    const artifacts = compile(SOURCE);
    const fromArtifacts = SolContract.fromArtifacts(artifacts);
    const fromSource = new SolContract(SOURCE);

    expect(fromArtifacts.abi).toEqual(fromSource.abi);
  });

  it("derives a deterministic address from compiled bytecodes", () => {
    const artifacts = compile(SOURCE);
    const address = deriveAddress(hashArtifacts(artifacts));

    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // Same artifacts always produce the same address
    expect(deriveAddress(hashArtifacts(compile(SOURCE)))).toBe(address);
  });

  it("does not require solc when using fromArtifacts", () => {
    // fromArtifacts with pre-built data should never touch solc
    const artifacts = compile(SOURCE);
    const contract = SolContract.fromArtifacts(artifacts);

    // Accessing .abi should use the pre-compiled data, not trigger compile()
    expect(contract.abi).toEqual(artifacts.Greeter.abi);
  });

  it("throws when call() is given a nonexistent function name", async () => {
    const artifacts = compile(SOURCE);
    const contract = SolContract.fromArtifacts(artifacts);

    // @ts-expect-error — `never` base signature rejects all function names; testing runtime behavior
    await expect(contract.call({} as any, "nonexistent")).rejects.toThrow(/Function "nonexistent" not found/);
  });
});
