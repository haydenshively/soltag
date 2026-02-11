import { describe, expect, it } from "vitest";

import {
  type ContractTypeEntry,
  generateDeclarationContent,
  jsonToConstType,
  solidityTypeToTs,
} from "../../src/codegen.js";
import type { SolcAbiParam } from "../../src/solc.js";

function param(type: string, name = "", components?: SolcAbiParam[]): SolcAbiParam {
  return { type, name, components };
}

const LENS_ABI = [
  {
    type: "function",
    name: "getBalance",
    inputs: [
      { name: "token", type: "address" },
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
];

const LENS_ENTRY: ContractTypeEntry = {
  contractName: "Lens",
  constructorInputs: [],
  abi: LENS_ABI,
};

const TOKEN_ENTRY: ContractTypeEntry = {
  contractName: "MyToken",
  constructorInputs: [{ name: "supply", type: "uint256" }],
  abi: [
    {
      type: "constructor",
      inputs: [{ name: "supply", type: "uint256" }],
      stateMutability: "nonpayable",
    },
  ],
};

describe("codegen", () => {
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

  describe("generateDeclarationContent", () => {
    it("generates bytecode map entries for named contracts", () => {
      const { content } = generateDeclarationContent([LENS_ENTRY]);

      expect(content).toContain('declare module "soltag"');
      expect(content).toContain("interface InlineContractConstructorArgsMap");
      expect(content).toContain('"Lens"');
    });

    it("returns empty string for empty entries", () => {
      const { content } = generateDeclarationContent([]);
      expect(content).toBe("");
    });

    it("deduplicates entries with same contractName and constructorInputs", () => {
      const { content } = generateDeclarationContent([LENS_ENTRY, LENS_ENTRY]);
      // Should only have one entry per contract name
      const lensMatches = content.match(/"Lens":/g);
      // One in AbiMap, one in BytecodeMap
      expect(lensMatches).toHaveLength(2);
    });

    it("detects duplicate names with different constructor signatures", () => {
      const altLens: ContractTypeEntry = {
        contractName: "Lens",
        constructorInputs: [{ name: "x", type: "uint256" }],
        abi: [{ type: "constructor", inputs: [{ name: "x", type: "uint256" }], stateMutability: "nonpayable" }],
      };

      const { duplicates } = generateDeclarationContent([LENS_ENTRY, altLens]);
      expect(duplicates).toContain("Lens");
    });

    it("does not flag duplicates with same constructor signatures", () => {
      const { duplicates } = generateDeclarationContent([LENS_ENTRY, LENS_ENTRY]);
      expect(duplicates).toHaveLength(0);
    });

    it("generates bytecode map entry with constructor params", () => {
      const { content } = generateDeclarationContent([TOKEN_ENTRY]);
      expect(content).toContain('"MyToken": [supply: bigint]');
    });

    it("generates empty tuple for contracts without constructors", () => {
      const { content } = generateDeclarationContent([LENS_ENTRY]);
      expect(content).toContain('"Lens": []');
    });

    it("includes export {} so declare module is an augmentation, not an ambient declaration", () => {
      const { content } = generateDeclarationContent([LENS_ENTRY]);
      expect(content).toContain("export {}");
    });

    it("names unnamed constructor params as arg0, arg1, etc.", () => {
      const entry: ContractTypeEntry = {
        contractName: "Test",
        constructorInputs: [
          { name: "", type: "uint256" },
          { name: "", type: "address" },
        ],
        abi: [],
      };
      const { content } = generateDeclarationContent([entry]);
      expect(content).toContain("arg0: bigint");
      expect(content).toContain("arg1: `0x${string}`");
    });

    it("generates InlineContractAbiMap entries with readonly ABI types", () => {
      const { content } = generateDeclarationContent([LENS_ENTRY]);
      expect(content).toContain("interface InlineContractAbiMap");
      expect(content).toContain('"Lens":');
      // Should contain the ABI serialized as a readonly type
      expect(content).toContain('readonly type: "function"');
      expect(content).toContain('readonly name: "getBalance"');
      expect(content).toContain('readonly stateMutability: "view"');
    });
  });

  describe("jsonToConstType", () => {
    it("serializes strings as JSON-quoted literals", () => {
      expect(jsonToConstType("hello")).toBe('"hello"');
    });

    it("serializes numbers", () => {
      expect(jsonToConstType(42)).toBe("42");
    });

    it("serializes booleans", () => {
      expect(jsonToConstType(true)).toBe("true");
      expect(jsonToConstType(false)).toBe("false");
    });

    it("serializes null and undefined as null", () => {
      expect(jsonToConstType(null)).toBe("null");
      expect(jsonToConstType(undefined)).toBe("null");
    });

    it("serializes empty arrays as readonly []", () => {
      expect(jsonToConstType([])).toBe("readonly []");
    });

    it("serializes arrays as readonly tuples", () => {
      expect(jsonToConstType(["a", "b"])).toBe('readonly ["a", "b"]');
    });

    it("serializes objects with readonly fields", () => {
      expect(jsonToConstType({ name: "foo", type: "uint256" })).toBe(
        '{ readonly name: "foo"; readonly type: "uint256" }',
      );
    });

    it("serializes nested structures deeply", () => {
      const value = {
        type: "function",
        inputs: [{ name: "x", type: "uint256" }],
      };
      const result = jsonToConstType(value);
      expect(result).toContain('readonly type: "function"');
      expect(result).toContain('readonly [{ readonly name: "x"; readonly type: "uint256" }]');
    });
  });
});
