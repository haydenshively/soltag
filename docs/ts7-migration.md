# TypeScript 7 migration plan (oxc-parser)

Status: **deferred** (drafted 2026-08-31). An interim patch shipped first: all runtime/type
imports of `typescript` were swapped to `@typescript/typescript6` (Microsoft's compat package
re-exporting TS 6), which unblocks projects that install `typescript@7`. This document is the
full decoupling plan to execute later — likely once TS 7.1's Language Service API ships and
the editor-diagnostics story is clear.

## Context

TypeScript 7.0 (Go-native, GA July 2026) changed two things soltag depends on:

1. **No programmatic JS API.** `import ts from "typescript"` on TS 7 has no `createProgram` /
   `createSourceFile` / `forEachChild`. Microsoft: *"TypeScript 7.0 does not ship with an API.
   We expect TypeScript 7.1 to ship with a new (and different) API."*
2. **No tsserver plugin loading.** The native language service has no plugin hook (also ≥7.1,
   shape unknown).

| Surface | Uses today | TS 7 status |
|---|---|---|
| bundler plugins (`src/bundler/unplugin.ts`) | `ts.createSourceFile` + AST walk | Broken (fixed by interim patch) |
| `soltag` CLI (`src/cli.ts`) | `ts.findConfigFile/parseJsonConfigFileContent/createProgram` | Broken (fixed by interim patch) |
| `soltag/plugin` (`src/editor/*`) | tsserver plugin API + TS AST | **Cannot load under TS 7's LS** |
| repo `tsc --noEmit` | `esModuleInterop`, `forceConsistentCasingInFileNames`, `export =` hack | Minor cleanups |

The generated `.soltag/types.d.ts` (module augmentation of `"soltag"`) is plain TS and works
unchanged; only its *producers* and the inline diagnostics break.

## Key observation

Nothing in soltag needs a type checker. `src/ast-utils.ts` only does: tagged-template
detection, string/template literal text, same-file `const` identifier lookup, `+`
concatenation, `solFile(...)` call shape, and spans. Even the editor plugin uses TS only for
the LS handshake (`getSemanticDiagnostics`, `getProgram().getSourceFile(f).text`,
`DiagnosticCategory`); `analysis.ts` and `mapCompiledPosToEditor` in `diagnostics.ts` work
purely on spans + template text.

So soltag can own **one** parser for all three surfaces and drop the TS dependency entirely.

## Why not wait for the TS 7.1 API instead?

7.1 (stable 2026-11-10 per the [iteration plan](https://github.com/microsoft/TypeScript/issues/63703))
stabilizes Content Mapper / Emit / Language Service APIs — IPC-bridge APIs to the Go compiler
process, in the `@typescript/api` lineage. They're valuable for *checker* access, which soltag
doesn't use. For syntax-only per-file parsing in a bundler hot path, an in-process native
parser is strictly better (no RPC round-trip, no TS version coupling, no 24 MB dep), and this
matches the ecosystem: Vite/Rolldown are built on oxc; no bundler parses with TS's API. The
one 7.1-contingent piece is editor squiggles — see §4.

## Parser choice: `oxc-parser`

- ESTree AST with TS extensions (`TaggedTemplateExpression.quasi.quasis[].value.cooked`,
  `.expressions`, `VariableDeclaration.kind === "const"`, spans as `start`/`end`).
- Size: ~1.4 MB core + ~1.8 MB per-platform napi binding (`optionalDependencies`, like
  esbuild). Compare `@typescript/typescript6` → pulls `typescript@6` ≈ 24 MB; `@swc/core`
  ≈ 26 MB/platform with process-global spans (a known footgun with `magic-string`).
  Node `^20.19 || >=22.12`.
- Verified against `oxc-parser@0.147.0` typings: `parseSync(filename, text, { lang, astType,
  range?, preserveParens })`, result `{ program, errors, comments, module }`.
- **Must verify in a test**: spans are UTF-16 code-unit offsets — required because
  `magic-string` and tsserver both index UTF-16. Add a test with a non-ASCII comment
  preceding a `sol()` template.
- Pin an exact minor (`"oxc-parser": "~0.147.0"`); it's pre-1.0 and AST/option changes land
  often. Import types from `@oxc-project/types`.

## Plan

### 1. Rewrite `src/ast-utils.ts` on oxc (behavior-preserving)

- Remove the `ts: TS` parameter everywhere; node params become `@oxc-project/types` nodes
  (`Expression`, `TemplateLiteral`, `CallExpression`, `Program`).
- Mapping: `isStringLiteral` → `Literal` w/ string value; `NoSubstitutionTemplateLiteral` /
  `TemplateExpression` → `TemplateLiteral` (`quasis[i].value.cooked` interleaved with
  `expressions`); `isIdentifier` → `Identifier.name`; `BinaryExpression.operator === "+"`;
  `ObjectExpression`/`Property` with `key: Identifier`, `value: Literal(true|false)`;
  `Program.body` `VariableDeclaration` with `kind === "const"` and `id: Identifier`.
  Unwrap `ParenthesizedExpression` (default `preserveParens: true`) or pass
  `preserveParens: false`.
- Replace `sourceFile: SourceFile` params with `program` + `fileName` (only used for
  `solFile` resolution and top-level const lookup).
- `SolFileError.node` becomes a `Span` (`{start,end}`); that's all consumers use.
- Add `src/parse.ts`: `parseTs(fileName, code)` wrapping `parseSync` (choose `lang` from
  extension, `sourceType: 'module'`) plus a generic `walk(node, visit)` and
  `findSolTemplateLiterals(program, fileName)` (moved from `src/editor/analysis.ts` so
  bundler, CLI and editor share it — today the visitor is duplicated three times).
- Tests `test/ast-utils.solFile.test.ts`, `test/editor/analysis*.test.ts` currently build TS
  source files; switch them to `parseTs`. `test/bundler/*` are black-box on
  `transformSolTemplates` and should pass unchanged.

### 2. Bundler (`src/bundler/unplugin.ts`)

- Swap `ts.createSourceFile` for `parseTs`; `node.getStart/getEnd` → `node.start/end`; the
  error line/col message uses a small offset→line/col helper in `parse.ts`.
- Keep the regex fast-path.
- `tsup.config.ts`: remove the TS package from externals; add `'oxc-parser'` (native — must
  stay external in every entry).

### 3. CLI (`src/cli.ts`) — drop `ts.createProgram`, add `--watch`

- File enumeration: `get-tsconfig` (handles `extends`, returns `files`/`include`/`exclude`)
  + `tinyglobby` for the globs, defaulting `include` to `**/*` with TS's default extensions
  and excluding `outDir`/`node_modules`. Both pure JS, tiny, ubiquitous (tsup/vite).
- Refactor the top-level script into `generateTypes(configPath): { written, warnings }`,
  sharing the "collect → compile → `generateDeclarationContent` → write-if-changed" logic
  with `src/editor/typegen.ts` (extract to `src/typegen-core.ts`; the editor's version
  differs only in logging).
- `--watch`: `fs.watch` (recursive on the project dir, filtered by the include set + `.sol`
  files) with ~300 ms debounce → `generateTypes`. Print solc errors/warnings to the terminal.
  `compileCached` in `src/solc.ts` already dedupes unchanged templates. This is the primary
  editor path for TS 7 users until squiggles return.

### 4. Editor plugin (`src/editor/*`) — keep for TS ≤6, port AST usage to oxc

- `analysis.ts`: delete; use `findSolTemplateLiterals` from `src/parse.ts`, fed
  `parseTs(sourceFile.fileName, sourceFile.text)`.
- `diagnostics.ts`: `mapCompiledPosToEditor` over oxc `TemplateLiteral` (`quasis[i].start + 1`
  etc. — same arithmetic, spans instead of `getStart(sourceFile)`). `ts` is still needed for
  `DiagnosticCategory` and the LS proxy; keep a type-only import (the runtime `ts` is
  injected by the host tsserver).
- `typegen.ts`: use `typegen-core`; iterate `program.getSourceFiles()` as today.
- `index.ts`: replace the `// @ts-expect-error … export = init` hack with
  `export default init` + tsup `footer: { js: 'module.exports = module.exports.default;' }`
  on the CJS plugin entry (tsserver requires the module itself to be the init function).
- Inline squiggles have no TS 7 path until ≥7.1 exposes an LS hook. Longer-term home: the
  `soltag-highlighter` VS Code extension owning a `DiagnosticCollection` — it can reuse
  `parse.ts` + the position mapper directly, since neither needs TS after this migration.
  Re-evaluate when the 7.1 LS API ships.

### 5. `package.json` / `tsconfig.json`

- `dependencies`: add `oxc-parser`, `@oxc-project/types`, `get-tsconfig`, `tinyglobby`;
  remove `@typescript/typescript6`.
- Keep `typescript` as devDependency only, bumped to `^7.0.0` so `pnpm typecheck` uses the
  TS 7 compiler. Verify TS 7 still ships `lib/typescript.d.ts` for the plugin's type-only
  import; if not, keep `@typescript/typescript6` as a devDependency for types only.
- `tsconfig.json`: remove `esModuleInterop` and `forceConsistentCasingInFileNames`
  (always-on in TS 7); add `"types": ["node"]` (TS 7 defaults `types` to `[]`).
- `engines.node: "^20.19.0 || >=22.12.0"` (inherited from oxc-parser).

### 6. README

- Setup split: "TypeScript plugin (TS 5/6 editors)" vs "TypeScript 7: `soltag --watch` +
  `.soltag` in `include`".
- Keep the side-by-side alias recipe for plugin-in-editor + TS 7 CLI:

  ```json
  "typescript": "npm:@typescript/typescript6@^6.0.2",
  "@typescript/native": "npm:typescript@^7.0.2"
  ```

## Verification

1. `pnpm i && pnpm typecheck` with `typescript@7` as dev compiler — passes, no
   deprecated-option diagnostics.
2. `pnpm test` — all suites green; new test: file with `// héllo 😀` before a `sol("A")`
   template transforms with correct replacement bounds (proves UTF-16 spans).
3. `pnpm build`; scratch project with **only** `typescript@7` installed: `node dist/cli.js`
   writes `.soltag/types.d.ts`; TS 7 `tsc --noEmit` narrows `lens.abi` / `lens.with(...)`
   with `.soltag` in `include`; Vite build via `soltag/vite` compiles a template;
   `solFile("./x.sol")` and a bare-specifier `solFile` still resolve.
4. `soltag --watch`: edit a template / imported `.sol` → regenerates within ~1 s; a Solidity
   error prints to the terminal.
5. Scratch project on TS 6 in VS Code: `soltag/plugin` still loads (tsserver log
   "soltag plugin loaded"), squiggles land on the right span incl. inside interpolated
   templates — confirms the oxc port of `mapCompiledPosToEditor` and the plugin-entry change.
6. `du -sh node_modules` of the scratch project before/after to confirm dropping the TS
   dependency actually shrinks installs.
