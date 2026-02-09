import { describe, expect, it } from "vitest";

import { solidityTypeToTs } from "../../src/codegen.js";
import type { SolcAbiParam } from "../../src/solc.js";

function param(type: string, name = "", components?: SolcAbiParam[]): SolcAbiParam {
  return { type, name, components };
}

describe("solidityTypeToTs", () => {
  it("maps address to hex template literal", () => {
    expect(solidityTypeToTs(param("address"))).toBe("`0x${string}`");
  });

  it("maps bool to boolean", () => {
    expect(solidityTypeToTs(param("bool"))).toBe("boolean");
  });

  it("maps string to string", () => {
    expect(solidityTypeToTs(param("string"))).toBe("string");
  });

  it("maps bytes to hex template literal", () => {
    expect(solidityTypeToTs(param("bytes"))).toBe("`0x${string}`");
  });

  it("maps fixed bytes to hex template literal", () => {
    expect(solidityTypeToTs(param("bytes32"))).toBe("`0x${string}`");
    expect(solidityTypeToTs(param("bytes4"))).toBe("`0x${string}`");
  });

  it("maps uint/int variants to bigint", () => {
    expect(solidityTypeToTs(param("uint256"))).toBe("bigint");
    expect(solidityTypeToTs(param("uint8"))).toBe("bigint");
    expect(solidityTypeToTs(param("int256"))).toBe("bigint");
    expect(solidityTypeToTs(param("uint"))).toBe("bigint");
    expect(solidityTypeToTs(param("int"))).toBe("bigint");
  });

  it("maps dynamic arrays", () => {
    expect(solidityTypeToTs(param("address[]"))).toBe("`0x${string}`[]");
    expect(solidityTypeToTs(param("uint256[]"))).toBe("bigint[]");
    expect(solidityTypeToTs(param("bool[]"))).toBe("boolean[]");
  });

  it("maps fixed-size arrays", () => {
    expect(solidityTypeToTs(param("address[3]"))).toBe("`0x${string}`[]");
    expect(solidityTypeToTs(param("uint256[10]"))).toBe("bigint[]");
  });

  it("maps tuples with components", () => {
    const result = solidityTypeToTs(param("tuple", "", [param("uint256", "amount"), param("address", "recipient")]));
    expect(result).toBe("{ amount: bigint; recipient: `0x${string}` }");
  });

  it("returns unknown for unrecognized types", () => {
    expect(solidityTypeToTs(param("weird_custom_type"))).toBe("unknown");
  });
});
