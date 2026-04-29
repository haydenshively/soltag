import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { extractTemplateSource, resolveStringExpression, SolFileError, stripSolidityHeader } from "../src/ast-utils.js";

function createSourceFile(code: string, fileName = "test.ts"): ts.SourceFile {
  return ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
}

function findFirstCallTo(name: string, sourceFile: ts.SourceFile): ts.CallExpression | undefined {
  let found: ts.CallExpression | undefined;
  function visit(node: ts.Node) {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function findFirstTaggedTemplate(sourceFile: ts.SourceFile): ts.TaggedTemplateExpression | undefined {
  let found: ts.TaggedTemplateExpression | undefined;
  function visit(node: ts.Node) {
    if (found) return;
    if (ts.isTaggedTemplateExpression(node)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

describe("stripSolidityHeader", () => {
  it("strips leading SPDX comment", () => {
    const out = stripSolidityHeader("// SPDX-License-Identifier: MIT\ninterface I {}\n");
    expect(out).toBe("interface I {}\n");
  });

  it("strips leading pragma solidity", () => {
    const out = stripSolidityHeader("pragma solidity ^0.8.24;\ninterface I {}\n");
    expect(out).toBe("interface I {}\n");
  });

  it("strips SPDX + pragma + blank lines together", () => {
    const out = stripSolidityHeader(
      "// SPDX-License-Identifier: MIT\n\npragma solidity ^0.8.24;\npragma abicoder v2;\n\ninterface I {}\n",
    );
    expect(out).toBe("interface I {}\n");
  });

  it("preserves body content after the header block", () => {
    const out = stripSolidityHeader(
      "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n\ninterface I {\n  function f() external;\n}\n",
    );
    expect(out).toContain("interface I {");
    expect(out).toContain("function f() external;");
  });

  it("does not strip pragmas appearing after the body has started", () => {
    const out = stripSolidityHeader("interface I {}\npragma solidity ^0.8.24;\n");
    expect(out).toContain("pragma solidity");
  });

  it("returns input unchanged when there is no header", () => {
    const out = stripSolidityHeader("interface I {}\n");
    expect(out).toBe("interface I {}\n");
  });
});

describe("solFile resolution", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "soltag-solfile-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSolFile(name: string, contents: string): string {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, contents, "utf-8");
    return p;
  }

  it("reads a sibling file and splices its contents", () => {
    writeSolFile(
      "IERC20.sol",
      "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\ninterface IERC20 { function balanceOf(address) external view returns (uint256); }\n",
    );

    const tsFile = path.join(tmpDir, "lens.ts");
    const code = `const x = solFile("./IERC20.sol");`;
    const sourceFile = createSourceFile(code, tsFile);
    const call = findFirstCallTo("solFile", sourceFile);
    expect(call).toBeDefined();

    const resolved = resolveStringExpression(ts, call!, sourceFile);
    expect(resolved).toContain("interface IERC20");
    // Default behavior: leading SPDX + pragma stripped.
    expect(resolved).not.toContain("SPDX-License-Identifier");
    expect(resolved).not.toMatch(/^\s*pragma\s+solidity/m);
  });

  it("resolves paths relative to the .ts file's directory", () => {
    const subdir = path.join(tmpDir, "contracts");
    fs.mkdirSync(subdir);
    fs.writeFileSync(path.join(subdir, "Lib.sol"), "library L {}\n", "utf-8");

    const tsFile = path.join(tmpDir, "src", "lens.ts");
    fs.mkdirSync(path.dirname(tsFile));
    const code = `const x = solFile("../contracts/Lib.sol");`;
    const sourceFile = createSourceFile(code, tsFile);
    const call = findFirstCallTo("solFile", sourceFile);

    const resolved = resolveStringExpression(ts, call!, sourceFile);
    expect(resolved).toContain("library L {}");
  });

  it("preserves header when { raw: true }", () => {
    writeSolFile("IFoo.sol", "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\ninterface IFoo {}\n");

    const tsFile = path.join(tmpDir, "lens.ts");
    const code = `const x = solFile("./IFoo.sol", { raw: true });`;
    const sourceFile = createSourceFile(code, tsFile);
    const call = findFirstCallTo("solFile", sourceFile);

    const resolved = resolveStringExpression(ts, call!, sourceFile);
    expect(resolved).toContain("SPDX-License-Identifier");
    expect(resolved).toMatch(/pragma\s+solidity/);
  });

  it("re-reads on every call (no caching)", () => {
    const filePath = writeSolFile("IFoo.sol", "interface IFoo { function v1() external; }\n");

    const tsFile = path.join(tmpDir, "lens.ts");
    const code = `const x = solFile("./IFoo.sol");`;
    const sourceFile = createSourceFile(code, tsFile);
    const call = findFirstCallTo("solFile", sourceFile);

    const first = resolveStringExpression(ts, call!, sourceFile);
    expect(first).toContain("function v1()");

    // Mutate the file; next resolution should reflect the change without
    // any explicit cache invalidation step.
    fs.writeFileSync(filePath, "interface IFoo { function v2() external; }\n", "utf-8");

    const second = resolveStringExpression(ts, call!, sourceFile);
    expect(second).toContain("function v2()");
    expect(second).not.toContain("function v1()");
  });

  it("throws SolFileError when the file is missing", () => {
    const tsFile = path.join(tmpDir, "lens.ts");
    const code = `const x = solFile("./does-not-exist.sol");`;
    const sourceFile = createSourceFile(code, tsFile);
    const call = findFirstCallTo("solFile", sourceFile);

    expect(() => resolveStringExpression(ts, call!, sourceFile)).toThrowError(SolFileError);
  });

  it("throws SolFileError with the call-expression node attached", () => {
    const tsFile = path.join(tmpDir, "lens.ts");
    const code = `const x = solFile("./does-not-exist.sol");`;
    const sourceFile = createSourceFile(code, tsFile);
    const call = findFirstCallTo("solFile", sourceFile);

    try {
      resolveStringExpression(ts, call!, sourceFile);
      expect.fail("expected SolFileError");
    } catch (err) {
      expect(err).toBeInstanceOf(SolFileError);
      expect((err as SolFileError).node).toBe(call);
    }
  });

  it("returns undefined when the path argument is dynamic", () => {
    const tsFile = path.join(tmpDir, "lens.ts");
    const code = `let dyn = "./foo.sol"; const x = solFile(dyn);`;
    const sourceFile = createSourceFile(code, tsFile);
    const call = findFirstCallTo("solFile", sourceFile);

    expect(resolveStringExpression(ts, call!, sourceFile)).toBeUndefined();
  });

  it("returns undefined for unknown opts keys", () => {
    const tsFile = path.join(tmpDir, "lens.ts");
    const code = `const x = solFile("./foo.sol", { unknown: "bar" });`;
    const sourceFile = createSourceFile(code, tsFile);
    const call = findFirstCallTo("solFile", sourceFile);

    expect(resolveStringExpression(ts, call!, sourceFile)).toBeUndefined();
  });

  describe("bare specifiers (workspace packages)", () => {
    function writeWorkspacePackage(args: {
      pkgRoot: string;
      pkgName: string;
      solFiles: Record<string, string>;
      exports?: Record<string, string>;
    }): void {
      fs.mkdirSync(path.join(args.pkgRoot, "solidity"), { recursive: true });
      const exportsMap = args.exports ?? { "./solidity/*.sol": "./solidity/*.sol" };
      fs.writeFileSync(
        path.join(args.pkgRoot, "package.json"),
        JSON.stringify({ name: args.pkgName, version: "0.0.0", exports: exportsMap }),
        "utf-8",
      );
      for (const [name, contents] of Object.entries(args.solFiles)) {
        fs.writeFileSync(path.join(args.pkgRoot, "solidity", name), contents, "utf-8");
      }
    }

    it("resolves a bare specifier via the package's exports subpath pattern", () => {
      const pkgRoot = path.join(tmpDir, "node_modules", "@repo", "contracts");
      writeWorkspacePackage({
        pkgRoot,
        pkgName: "@repo/contracts",
        solFiles: {
          "IVault.sol":
            "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\ninterface IVault { function totalAssets() external view returns (uint256); }\n",
        },
      });

      const tsFile = path.join(tmpDir, "src", "lens.ts");
      fs.mkdirSync(path.dirname(tsFile));
      const code = `const x = solFile("@repo/contracts/solidity/IVault.sol");`;
      const sourceFile = createSourceFile(code, tsFile);
      const call = findFirstCallTo("solFile", sourceFile);

      const resolved = resolveStringExpression(ts, call!, sourceFile);
      expect(resolved).toContain("interface IVault");
      expect(resolved).not.toContain("SPDX-License-Identifier");
      expect(resolved).not.toMatch(/^\s*pragma\s+solidity/m);
    });

    it("resolves bare specifiers across pnpm-style symlinks", () => {
      // Real package lives at packages/contracts and is symlinked from
      // node_modules/@repo/contracts — same shape pnpm produces.
      const realPkgRoot = path.join(tmpDir, "packages", "contracts");
      writeWorkspacePackage({
        pkgRoot: realPkgRoot,
        pkgName: "@repo/contracts",
        solFiles: {
          "ILib.sol": "library L {}\n",
        },
      });

      const linkParent = path.join(tmpDir, "consumer", "node_modules", "@repo");
      fs.mkdirSync(linkParent, { recursive: true });
      fs.symlinkSync(realPkgRoot, path.join(linkParent, "contracts"), "dir");

      const tsFile = path.join(tmpDir, "consumer", "src", "lens.ts");
      fs.mkdirSync(path.dirname(tsFile), { recursive: true });
      const code = `const x = solFile("@repo/contracts/solidity/ILib.sol");`;
      const sourceFile = createSourceFile(code, tsFile);
      const call = findFirstCallTo("solFile", sourceFile);

      const resolved = resolveStringExpression(ts, call!, sourceFile);
      expect(resolved).toContain("library L {}");
    });

    it("throws SolFileError when a bare specifier cannot be resolved", () => {
      const tsFile = path.join(tmpDir, "lens.ts");
      const code = `const x = solFile("@repo/does-not-exist/Foo.sol");`;
      const sourceFile = createSourceFile(code, tsFile);
      const call = findFirstCallTo("solFile", sourceFile);

      try {
        resolveStringExpression(ts, call!, sourceFile);
        expect.fail("expected SolFileError");
      } catch (err) {
        expect(err).toBeInstanceOf(SolFileError);
        expect((err as SolFileError).specifier).toBe("@repo/does-not-exist/Foo.sol");
        expect((err as SolFileError).node).toBe(call);
      }
    });

    it("error message reports the original specifier, not the resolved path", () => {
      const tsFile = path.join(tmpDir, "lens.ts");
      const code = `const x = solFile("./missing.sol");`;
      const sourceFile = createSourceFile(code, tsFile);
      const call = findFirstCallTo("solFile", sourceFile);

      try {
        resolveStringExpression(ts, call!, sourceFile);
        expect.fail("expected SolFileError");
      } catch (err) {
        expect(err).toBeInstanceOf(SolFileError);
        expect((err as SolFileError).message).toContain('solFile("./missing.sol")');
      }
    });
  });

  it("resolves solFile inside a sol() tagged template via extractTemplateSource", () => {
    writeSolFile(
      "IFoo.sol",
      "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\ninterface IFoo { function getX() external view returns (uint256); }\n",
    );

    const tsFile = path.join(tmpDir, "lens.ts");
    const code = `
const lens = sol("Lens")\`
  pragma solidity ^0.8.24;
  \${solFile("./IFoo.sol")}
  contract Lens {}
\`;
`;
    const sourceFile = createSourceFile(code, tsFile);
    const tagged = findFirstTaggedTemplate(sourceFile);
    expect(tagged).toBeDefined();

    const resolved = extractTemplateSource(ts, tagged!.template, sourceFile);
    expect(resolved).toBeDefined();
    expect(resolved).toContain("interface IFoo");
    expect(resolved).toContain("contract Lens");
    // Only the lens template's pragma should appear; the imported one was stripped.
    const pragmaCount = (resolved!.match(/pragma\s+solidity/g) ?? []).length;
    expect(pragmaCount).toBe(1);
  });
});
