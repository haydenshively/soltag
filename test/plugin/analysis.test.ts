import { describe, it, expect } from "vitest";
import ts from "typescript";
import {
  findSolTemplateLiterals,
  traceToSolLiteral,
  getCallSiteAtPosition,
  getArgumentIndex,
  isSolTag,
} from "../../src/plugin/analysis.js";

function createSourceFile(code: string): ts.SourceFile {
  return ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
}

describe("plugin analysis", () => {
  describe("findSolTemplateLiterals", () => {
    it("finds a simple sol template literal", () => {
      const source = createSourceFile(`
        const x = sol\`pragma solidity ^0.8.24; contract A {}\`;
      `);

      const results = findSolTemplateLiterals(ts, source);
      expect(results).toHaveLength(1);
      expect(results[0].source).toContain("pragma solidity");
      expect(results[0].source).toContain("contract A");
    });

    it("finds multiple sol template literals", () => {
      const source = createSourceFile(`
        const a = sol\`pragma solidity ^0.8.24; contract A {}\`;
        const b = sol\`pragma solidity ^0.8.24; contract B {}\`;
      `);

      const results = findSolTemplateLiterals(ts, source);
      expect(results).toHaveLength(2);
    });

    it("ignores non-sol tagged templates", () => {
      const source = createSourceFile(`
        const a = html\`<div></div>\`;
        const b = css\`body { color: red; }\`;
        const c = sol\`pragma solidity ^0.8.24; contract A {}\`;
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

    it("finds sol('Name') factory form template literal", () => {
      const source = createSourceFile(`
        const x = sol("Lens")\`pragma solidity ^0.8.24; contract Lens {}\`;
      `);

      const results = findSolTemplateLiterals(ts, source);
      expect(results).toHaveLength(1);
      expect(results[0].source).toContain("contract Lens");
      expect(results[0].contractName).toBe("Lens");
    });

    it("sets contractName to undefined for plain sol form", () => {
      const source = createSourceFile(`
        const x = sol\`pragma solidity ^0.8.24; contract A {}\`;
      `);

      const results = findSolTemplateLiterals(ts, source);
      expect(results).toHaveLength(1);
      expect(results[0].contractName).toBeUndefined();
    });

    it("finds both plain and factory forms in the same file", () => {
      const source = createSourceFile(`
        const a = sol\`pragma solidity ^0.8.24; contract A {}\`;
        const b = sol("B")\`pragma solidity ^0.8.24; contract B {}\`;
      `);

      const results = findSolTemplateLiterals(ts, source);
      expect(results).toHaveLength(2);
      expect(results[0].contractName).toBeUndefined();
      expect(results[1].contractName).toBe("B");
    });
  });

  describe("traceToSolLiteral", () => {
    it("traces a direct sol tagged template", () => {
      const source = createSourceFile(`
        const x = sol\`pragma solidity ^0.8.24; contract A {}\`;
      `);

      const literals = findSolTemplateLiterals(ts, source);
      expect(literals).toHaveLength(1);

      // Trace the tagged template expression itself
      const result = traceToSolLiteral(ts, literals[0].node, source);
      expect(result).toContain("contract A");
    });

    it("traces a variable reference to its sol literal declaration", () => {
      const code = `const myContract = sol\`pragma solidity ^0.8.24; contract Foo {}\`;
myContract.call(client, 'test');`;
      const source = createSourceFile(code);

      // Find the identifier 'myContract' in the .call() expression
      let callExprObj: ts.Node | undefined;
      function visit(node: ts.Node) {
        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "myContract" &&
          node.name.text === "call"
        ) {
          callExprObj = node.expression;
        }
        ts.forEachChild(node, visit);
      }
      visit(source);

      expect(callExprObj).toBeDefined();
      const result = traceToSolLiteral(ts, callExprObj!, source);
      expect(result).toContain("contract Foo");
    });

    it("traces a factory form variable reference to its sol literal", () => {
      const code = `const myContract = sol("Foo")\`pragma solidity ^0.8.24; contract Foo {}\`;
myContract.call(client, 'test');`;
      const source = createSourceFile(code);

      let callExprObj: ts.Node | undefined;
      function visit(node: ts.Node) {
        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "myContract" &&
          node.name.text === "call"
        ) {
          callExprObj = node.expression;
        }
        ts.forEachChild(node, visit);
      }
      visit(source);

      expect(callExprObj).toBeDefined();
      const result = traceToSolLiteral(ts, callExprObj!, source);
      expect(result).toContain("contract Foo");
    });
  });

  describe("getCallSiteAtPosition", () => {
    it("detects a .call() on a sol-derived variable", () => {
      const code = `const c = sol\`pragma solidity ^0.8.24; contract A { function foo() external pure returns (uint256) { return 1; } }\`;
c.call(client, 'foo');`;
      const source = createSourceFile(code);

      // Position inside 'foo' string literal
      const fooPos = code.indexOf("'foo'") + 1;
      const callSite = getCallSiteAtPosition(ts, source, fooPos);

      expect(callSite).toBeDefined();
      expect(callSite!.soliditySource).toContain("contract A");
      expect(callSite!.functionName).toBe("foo");
    });

    it("returns undefined for non-sol .call()", () => {
      const code = `const c = something();
c.call(client, 'foo');`;
      const source = createSourceFile(code);

      const fooPos = code.indexOf("'foo'") + 1;
      const callSite = getCallSiteAtPosition(ts, source, fooPos);
      expect(callSite).toBeUndefined();
    });

    it("returns undefined for position outside .call()", () => {
      const code = `const c = sol\`pragma solidity ^0.8.24; contract A {}\`;
const x = 42;`;
      const source = createSourceFile(code);

      const xPos = code.indexOf("42");
      const callSite = getCallSiteAtPosition(ts, source, xPos);
      expect(callSite).toBeUndefined();
    });
  });

  describe("getArgumentIndex", () => {
    it("returns correct argument indices", () => {
      const code = `c.call(client, 'foo', [1, 2])`;
      const source = createSourceFile(code);

      // Find the call expression
      let callExpr: ts.CallExpression | undefined;
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node)) callExpr = node;
        ts.forEachChild(node, visit);
      }
      visit(source);
      expect(callExpr).toBeDefined();

      // Position in 'client' → arg 0
      const clientPos = code.indexOf("client");
      expect(getArgumentIndex(callExpr!, clientPos, source)).toBe(0);

      // Position in 'foo' → arg 1
      const fooPos = code.indexOf("'foo'");
      expect(getArgumentIndex(callExpr!, fooPos, source)).toBe(1);

      // Position in '[1, 2]' → arg 2
      const argsPos = code.indexOf("[1");
      expect(getArgumentIndex(callExpr!, argsPos, source)).toBe(2);
    });
  });
});
