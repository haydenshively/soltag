import * as fs from "fs";
import * as path from "path";

import type tslib from "typescript/lib/tsserverlibrary";

import {
  type ContractTypeEntry,
  type FunctionOverload,
  generateDeclarationContent,
  SOLTAG_DIR,
  SOLTAG_TYPES_FILE,
} from "../codegen.js";

import { findSolTemplateLiterals } from "./analysis.js";
import { compileCached, getContractAbi, type SolcStandardOutput } from "./solc-cache.js";

/**
 * Get the path to the generated types file for a project directory.
 */
export function getTypesFilePath(projectDirectory: string): string {
  return path.join(projectDirectory, SOLTAG_DIR, SOLTAG_TYPES_FILE);
}

export interface RawSolEntry {
  contractName: string | undefined;
  source: string;
}

/**
 * Collect all sol template entries from the project's source files.
 */
export function collectSolEntries(ts: typeof tslib, info: tslib.server.PluginCreateInfo): RawSolEntry[] {
  const program = info.languageService.getProgram();
  if (!program) return [];

  const entries: RawSolEntry[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    // Skip declaration files and node_modules
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes("node_modules")) continue;

    const literals = findSolTemplateLiterals(ts, sourceFile);
    for (const lit of literals) {
      if (lit.source != null) {
        entries.push({
          contractName: lit.contractName,
          source: lit.source,
        });
      }
    }
  }

  return entries;
}

/**
 * Compile raw sol entries into ContractTypeEntry[] for codegen.
 * Filters to named entries only and extracts callable function ABIs.
 */
export function compileEntries(rawEntries: RawSolEntry[]): ContractTypeEntry[] {
  const named = rawEntries.filter((e): e is RawSolEntry & { contractName: string } => e.contractName != null);

  const entries: ContractTypeEntry[] = [];

  for (const raw of named) {
    let output: SolcStandardOutput;
    try {
      output = compileCached(raw.source);
    } catch {
      continue;
    }

    const abi = getContractAbi(output, raw.contractName);
    if (!abi) continue;

    const functions: FunctionOverload[] = [];
    for (const item of abi) {
      if (
        item.type === "function" &&
        (item.stateMutability === "view" || item.stateMutability === "pure") &&
        item.name
      ) {
        functions.push({
          name: item.name,
          inputs: item.inputs ?? [],
          outputs: item.outputs ?? [],
        });
      }
    }

    entries.push({ contractName: raw.contractName, functions });
  }

  return entries;
}

/**
 * Regenerate the .soltag/types.d.ts file if content has changed.
 * Returns true if the file was written (or deleted).
 */
export function regenerateTypesFile(
  ts: typeof tslib,
  info: tslib.server.PluginCreateInfo,
  projectDirectory: string,
): boolean {
  const typesFile = getTypesFilePath(projectDirectory);
  const rawEntries = collectSolEntries(ts, info);
  const compiled = compileEntries(rawEntries);
  const { content, duplicates } = generateDeclarationContent(compiled);

  for (const name of duplicates) {
    info.project.projectService.logger.info(
      `soltag: duplicate contract name "${name}" with different sources — only the first definition will be used for type generation`,
    );
  }

  if (content === "") {
    // No named templates — delete the file if it exists
    if (fs.existsSync(typesFile)) {
      fs.unlinkSync(typesFile);
      return true;
    }
    return false;
  }

  // Only write if content changed
  const dir = path.dirname(typesFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let existing: string | undefined;
  try {
    existing = fs.readFileSync(typesFile, "utf-8");
  } catch {
    // File doesn't exist yet
  }

  if (existing === content) return false;

  fs.writeFileSync(typesFile, content, "utf-8");
  return true;
}
