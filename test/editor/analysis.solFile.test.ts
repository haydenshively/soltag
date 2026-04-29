import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findSolTemplateLiterals } from "../../src/editor/analysis.js";

describe("findSolTemplateLiterals — solFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "soltag-analysis-solfile-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("captures resolverError when solFile path is missing", () => {
    const tsFile = path.join(tmpDir, "lens.ts");
    const code = `
const lens = sol("Lens")\`
  pragma solidity ^0.8.24;
  \${solFile("./does-not-exist.sol")}
  contract Lens {}
\`;
`;
    const sourceFile = ts.createSourceFile(tsFile, code, ts.ScriptTarget.Latest, true);
    const literals = findSolTemplateLiterals(
      ts as unknown as Parameters<typeof findSolTemplateLiterals>[0],
      sourceFile as unknown as Parameters<typeof findSolTemplateLiterals>[1],
    );

    expect(literals).toHaveLength(1);
    expect(literals[0].source).toBeUndefined();
    expect(literals[0].resolverError).toBeDefined();
    expect(literals[0].resolverError!.message).toContain("solFile");
    expect(literals[0].resolverError!.node).toBeDefined();
  });

  it("returns source (no resolverError) when solFile succeeds", () => {
    fs.writeFileSync(path.join(tmpDir, "IFoo.sol"), "interface IFoo {}\n", "utf-8");

    const tsFile = path.join(tmpDir, "lens.ts");
    const code = `
const lens = sol("Lens")\`
  pragma solidity ^0.8.24;
  \${solFile("./IFoo.sol")}
  contract Lens {}
\`;
`;
    const sourceFile = ts.createSourceFile(tsFile, code, ts.ScriptTarget.Latest, true);
    const literals = findSolTemplateLiterals(
      ts as unknown as Parameters<typeof findSolTemplateLiterals>[0],
      sourceFile as unknown as Parameters<typeof findSolTemplateLiterals>[1],
    );

    expect(literals).toHaveLength(1);
    expect(literals[0].source).toContain("interface IFoo");
    expect(literals[0].resolverError).toBeUndefined();
  });
});
