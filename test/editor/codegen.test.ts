import { describe, expect, it } from "vitest";

import { type ContractTypeEntry, generateDeclarationContent } from "../../src/codegen.js";

const LENS_ENTRY: ContractTypeEntry = {
  contractName: "Lens",
  functions: [
    {
      name: "add",
      inputs: [
        { name: "a", type: "uint256" },
        { name: "b", type: "uint256" },
      ],
      outputs: [{ name: "", type: "uint256" }],
    },
    {
      name: "getBalance",
      inputs: [{ name: "token", type: "address" }],
      outputs: [{ name: "", type: "uint256" }],
    },
  ],
};

describe("codegen", () => {
  describe("generateDeclarationContent", () => {
    it("generates call overloads for named contracts", () => {
      const { content } = generateDeclarationContent([LENS_ENTRY]);

      expect(content).toContain('declare module "soltag"');
      expect(content).toContain("SolContract<");
      expect(content).toContain('"Lens"');
      expect(content).toContain('"add"');
      expect(content).toContain('"getBalance"');
      expect(content).toContain("bigint");
      expect(content).toContain("Promise<");
    });

    it("returns empty string for empty entries", () => {
      const { content } = generateDeclarationContent([]);
      expect(content).toBe("");
    });

    it("deduplicates entries with same contractName and functions", () => {
      const { content } = generateDeclarationContent([LENS_ENTRY, LENS_ENTRY]);
      // Should only have one set of overloads
      const addMatches = content.match(/"add"/g);
      expect(addMatches).toHaveLength(1);
    });

    it("detects duplicate names with different function signatures", () => {
      const altLens: ContractTypeEntry = {
        contractName: "Lens",
        functions: [
          {
            name: "multiply",
            inputs: [
              { name: "a", type: "uint256" },
              { name: "b", type: "uint256" },
            ],
            outputs: [{ name: "", type: "uint256" }],
          },
        ],
      };

      const { duplicates } = generateDeclarationContent([LENS_ENTRY, altLens]);
      expect(duplicates).toContain("Lens");
    });

    it("does not flag duplicates with same function signatures", () => {
      const { duplicates } = generateDeclarationContent([LENS_ENTRY, LENS_ENTRY]);
      expect(duplicates).toHaveLength(0);
    });

    it("returns empty for entries with no functions", () => {
      const { content } = generateDeclarationContent([{ contractName: "Empty", functions: [] }]);
      expect(content).toBe("");
    });

    it("generates correct arg types for multiple parameters", () => {
      const { content } = generateDeclarationContent([LENS_ENTRY]);
      // add(uint256, uint256) → readonly [bigint, bigint]
      expect(content).toContain("readonly [bigint, bigint]");
    });

    it("uses this-parameter narrowing", () => {
      const { content } = generateDeclarationContent([LENS_ENTRY]);
      expect(content).toContain('this: SolContract<"Lens">');
    });

    it("includes export {} so declare module is an augmentation, not an ambient declaration", () => {
      const { content } = generateDeclarationContent([LENS_ENTRY]);
      expect(content).toContain("export {}");
    });
  });
});
