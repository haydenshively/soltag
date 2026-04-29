import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { transformSolTemplates } from "../../src/bundler/unplugin.js";

describe("unplugin transform — solFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "soltag-bundler-solfile-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves a solFile interpolation and produces a working artifact", () => {
    fs.writeFileSync(
      path.join(tmpDir, "IERC20.sol"),
      "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\ninterface IERC20 { function balanceOf(address) external view returns (uint256); }\n",
      "utf-8",
    );

    const tsFile = path.join(tmpDir, "lens.ts");
    const code = `
import { sol, solFile } from 'soltag';
const lens = sol("Lens")\`
  pragma solidity ^0.8.24;
  \${solFile("./IERC20.sol")}
  contract Lens {
    function getBalance(address token, address user) external view returns (uint256) {
      return IERC20(token).balanceOf(user);
    }
  }
\`;
`;

    const result = transformSolTemplates(code, tsFile);
    expect(result).toBeDefined();
    expect(result!.code).toContain('new __InlineContract("Lens",');
    expect(result!.code).toContain('"abi"');
    expect(result!.code).toContain('"deployedBytecode"');
    expect(result!.code).not.toContain("solFile(");
  });

  it("rethrows SolFileError as a build error with file:line context", () => {
    const tsFile = path.join(tmpDir, "lens.ts");
    const code = `
const lens = sol("Lens")\`
  pragma solidity ^0.8.24;
  \${solFile("./does-not-exist.sol")}
  contract Lens {}
\`;
`;

    expect(() => transformSolTemplates(code, tsFile)).toThrow(/lens\.ts:\d+:\d+/);
  });
});
