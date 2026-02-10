import ts from "typescript";
import { describe, expect, it } from "vitest";

import { findSolTemplateLiterals, isSolTag } from "../../src/editor/analysis.js";

function createSourceFile(code: string): ts.SourceFile {
  return ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
}

describe("plugin analysis", () => {
  describe("findSolTemplateLiterals", () => {
    it("finds sol('Name') factory form template literal", () => {
      const source = createSourceFile(`
        const x = sol("Lens")\`pragma solidity ^0.8.24; contract Lens {}\`;
      `);

      const results = findSolTemplateLiterals(ts, source);
      expect(results).toHaveLength(1);
      expect(results[0].source).toContain("contract Lens");
      expect(results[0].contractName).toBe("Lens");
    });

    it("finds multiple sol('Name') template literals", () => {
      const source = createSourceFile(`
        const a = sol("A")\`pragma solidity ^0.8.24; contract A {}\`;
        const b = sol("B")\`pragma solidity ^0.8.24; contract B {}\`;
      `);

      const results = findSolTemplateLiterals(ts, source);
      expect(results).toHaveLength(2);
      expect(results[0].contractName).toBe("A");
      expect(results[1].contractName).toBe("B");
    });

    it("ignores non-sol tagged templates", () => {
      const source = createSourceFile(`
        const a = html\`<div></div>\`;
        const b = css\`body { color: red; }\`;
        const c = sol("A")\`pragma solidity ^0.8.24; contract A {}\`;
      `);

      const results = findSolTemplateLiterals(ts, source);
      expect(results).toHaveLength(1);
      expect(results[0].source).toContain("contract A");
    });

    it("returns empty for files with no sol literals", () => {
      const source = createSourceFile(`
        const x = 42;
        function foo() { return 'hello'; }
      `);

      const results = findSolTemplateLiterals(ts, source);
      expect(results).toHaveLength(0);
    });

    it("ignores plain sol`` form (no longer supported)", () => {
      const source = createSourceFile(`
        const x = sol\`pragma solidity ^0.8.24; contract A {}\`;
      `);

      const results = findSolTemplateLiterals(ts, source);
      expect(results).toHaveLength(0);
    });
  });

  describe("isSolTag", () => {
    it("recognizes sol('Name') call expression", () => {
      const source = createSourceFile(`const x = sol("Lens")\`test\`;`);
      let tag: ts.Node | undefined;
      function visit(node: ts.Node) {
        if (ts.isTaggedTemplateExpression(node)) tag = node.tag;
        ts.forEachChild(node, visit);
      }
      visit(source);

      expect(tag).toBeDefined();
      const result = isSolTag(ts, tag!);
      expect(result).not.toBe(false);
      expect((result as { contractName: string }).contractName).toBe("Lens");
    });

    it("rejects plain sol identifier", () => {
      const source = createSourceFile(`const x = sol\`test\`;`);
      let tag: ts.Node | undefined;
      function visit(node: ts.Node) {
        if (ts.isTaggedTemplateExpression(node)) tag = node.tag;
        ts.forEachChild(node, visit);
      }
      visit(source);

      expect(tag).toBeDefined();
      expect(isSolTag(ts, tag!)).toBe(false);
    });

    it("rejects non-sol call expressions", () => {
      const source = createSourceFile(`const x = foo("Bar")\`test\`;`);
      let tag: ts.Node | undefined;
      function visit(node: ts.Node) {
        if (ts.isTaggedTemplateExpression(node)) tag = node.tag;
        ts.forEachChild(node, visit);
      }
      visit(source);

      expect(tag).toBeDefined();
      expect(isSolTag(ts, tag!)).toBe(false);
    });
  });
});
