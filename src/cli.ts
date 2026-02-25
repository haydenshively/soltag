import * as fs from "fs";
import * as path from "path";

import ts from "typescript";

import { extractTemplateSource, isSolTag } from "./ast-utils.js";
import { type ContractTypeEntry, generateDeclarationContent, SOLTAG_DIR, SOLTAG_TYPES_FILE } from "./codegen.js";
import { compileCached, getConstructorInputs, getContractAbi, type SolcStandardOutput } from "./solc.js";

// --- Parse args ---

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: soltag [-p <tsconfig.json>]");
  console.log("  -p, --project  Path to tsconfig.json (default: tsconfig.json in cwd)");
  process.exit(0);
}

let tsconfigArg: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "-p" || args[i] === "--project") {
    tsconfigArg = args[++i];
  }
}

// --- Load tsconfig ---

const searchPath = tsconfigArg ? path.resolve(tsconfigArg) : process.cwd();
const configPath = ts.findConfigFile(searchPath, ts.sys.fileExists);
if (!configPath) {
  console.error(`error: could not find tsconfig.json from ${searchPath}`);
  process.exit(1);
}

const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) {
  console.error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  process.exit(1);
}

const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
const program = ts.createProgram(parsed.fileNames, parsed.options);

// --- Collect sol() entries from source files ---

const rawEntries: { contractName: string; source: string }[] = [];

for (const sourceFile of program.getSourceFiles()) {
  if (sourceFile.isDeclarationFile) continue;
  if (sourceFile.fileName.includes("node_modules")) continue;

  function visit(node: ts.Node) {
    if (ts.isTaggedTemplateExpression(node)) {
      const solTag = isSolTag(ts, node.tag);
      if (solTag !== false) {
        const source = extractTemplateSource(ts, node.template, sourceFile);
        if (source != null) {
          rawEntries.push({ contractName: solTag.contractName, source });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

// --- Compile and generate types ---

const entries: ContractTypeEntry[] = [];

for (const raw of rawEntries) {
  let output: SolcStandardOutput;
  try {
    output = compileCached(raw.source);
  } catch {
    console.warn(`warning: failed to compile contract "${raw.contractName}"`);
    continue;
  }

  const constructorInputs = getConstructorInputs(output, raw.contractName);
  const abi = (getContractAbi(output, raw.contractName) ?? []) as unknown[];
  entries.push({ contractName: raw.contractName, constructorInputs, abi });
}

const { content, duplicates } = generateDeclarationContent(entries);

for (const name of duplicates) {
  console.warn(
    `warning: duplicate contract name "${name}" with different sources — only the first definition will be used`,
  );
}

// --- Write .soltag/types.d.ts ---

const projectDir = path.dirname(configPath);
const typesFile = path.join(projectDir, SOLTAG_DIR, SOLTAG_TYPES_FILE);

if (content === "") {
  if (fs.existsSync(typesFile)) {
    fs.unlinkSync(typesFile);
    console.log("Removed .soltag/types.d.ts (no contracts found)");
  } else {
    console.log("No sol() contracts found");
  }
} else {
  const dir = path.dirname(typesFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let existing: string | undefined;
  try {
    existing = fs.readFileSync(typesFile, "utf-8");
  } catch {
    // File doesn't exist yet
  }

  if (existing === content) {
    console.log(".soltag/types.d.ts is up to date");
  } else {
    fs.writeFileSync(typesFile, content, "utf-8");
    console.log(`Wrote .soltag/types.d.ts (${entries.length} contract${entries.length !== 1 ? "s" : ""})`);
  }
}
