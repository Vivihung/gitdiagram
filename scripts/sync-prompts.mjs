#!/usr/bin/env node
/**
 * Generates backend/app/prompts.py from lib/prompts.ts (via dist/lib/prompts.js).
 *
 * Run: node scripts/sync-prompts.mjs
 * Or:  pnpm sync:prompts  (after building lib)
 *
 * This ensures the Python backend and TypeScript lib share identical prompts.
 * The source of truth is lib/prompts.ts.
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Import the compiled prompts
const {
  SYSTEM_FIRST_PROMPT,
  SYSTEM_SECOND_PROMPT,
  SYSTEM_THIRD_PROMPT,
  SYSTEM_FIX_MERMAID_PROMPT,
} = await import(pathToFileURL(resolve(root, "dist/lib/prompts.js")).href);

function toPythonTripleQuote(str) {
  // Escape backslashes and triple-quotes inside the string
  const escaped = str.replace(/\\/g, "\\\\").replace(/"""/g, '\\"""');
  return `"""${escaped}"""`;
}

const output = `\
# AUTO-GENERATED from lib/prompts.ts — do not edit manually.
# Run: pnpm sync:prompts

SYSTEM_FIRST_PROMPT = ${toPythonTripleQuote(SYSTEM_FIRST_PROMPT)}

SYSTEM_SECOND_PROMPT = ${toPythonTripleQuote(SYSTEM_SECOND_PROMPT)}

SYSTEM_THIRD_PROMPT = ${toPythonTripleQuote(SYSTEM_THIRD_PROMPT)}

SYSTEM_FIX_MERMAID_PROMPT = ${toPythonTripleQuote(SYSTEM_FIX_MERMAID_PROMPT)}
`;

const outPath = resolve(root, "backend/app/prompts.py");
writeFileSync(outPath, output, "utf-8");
console.log(`Written: ${outPath}`);
