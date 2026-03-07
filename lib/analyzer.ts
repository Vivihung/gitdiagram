import { scanDirectory } from "./fs-scanner.js";
import {
  SYSTEM_FIRST_PROMPT,
  SYSTEM_SECOND_PROMPT,
  SYSTEM_THIRD_PROMPT,
  SYSTEM_FIX_MERMAID_PROMPT,
} from "./prompts.js";
import type { AnalysisResult, AnalyzeLocalOptions } from "./types.js";
import {
  validateMermaid,
  formatValidationFeedback,
} from "./validate-mermaid.js";

const MAX_FIX_ATTEMPTS = 3;

function formatUserMessage(data: Record<string, string | undefined>): string {
  return Object.entries(data)
    .filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    )
    .map(([key, value]) => `<${key}>\n${value}\n</${key}>`)
    .join("\n");
}

function extractComponentMapping(response: string): string {
  const start = response.indexOf("<component_mapping>");
  const end = response.indexOf("</component_mapping>");
  if (start === -1 || end === -1) return response;
  return response.slice(start, end);
}

function stripMermaidCodeFences(text: string): string {
  return text.replace(/```mermaid/g, "").replace(/```/g, "").trim();
}

/**
 * Analyze a local directory and produce a Mermaid architecture diagram.
 *
 * The caller provides their own LLM completion function, so this works
 * with any provider (OpenAI, Azure OpenAI, Anthropic, etc.).
 */
export async function analyzeLocal(
  options: AnalyzeLocalOptions,
): Promise<AnalysisResult> {
  const { path, complete, onProgress } = options;

  // Step 0: Scan directory
  onProgress?.("scanning", `Scanning ${path}...`);
  const { fileTree, readme } = await scanDirectory(path);

  // Step 1: Explanation
  onProgress?.("explanation", "Generating architecture explanation...");
  const explanation = await complete(
    SYSTEM_FIRST_PROMPT,
    formatUserMessage({ file_tree: fileTree, readme }),
  );

  // Step 2: Component mapping
  onProgress?.("mapping", "Creating component mapping...");
  const mappingResponse = await complete(
    SYSTEM_SECOND_PROMPT,
    formatUserMessage({ explanation, file_tree: fileTree }),
  );
  const componentMapping = extractComponentMapping(mappingResponse);

  // Step 3: Mermaid diagram
  onProgress?.("diagram", "Generating Mermaid diagram...");
  const mermaidRaw = await complete(
    SYSTEM_THIRD_PROMPT,
    formatUserMessage({ explanation, component_mapping: componentMapping }),
  );
  let mermaidCode = stripMermaidCodeFences(mermaidRaw);

  // Validate and auto-fix
  onProgress?.("validating", "Validating Mermaid syntax...");
  let validation = await validateMermaid(mermaidCode);

  let attempt = 0;
  while (!validation.valid && attempt < MAX_FIX_ATTEMPTS) {
    attempt++;
    onProgress?.(
      "fixing",
      `Fixing Mermaid syntax (attempt ${attempt}/${MAX_FIX_ATTEMPTS})...`,
    );

    const parserError = formatValidationFeedback(validation);
    const repaired = await complete(
      SYSTEM_FIX_MERMAID_PROMPT,
      formatUserMessage({
        mermaid_code: mermaidCode,
        parser_error: parserError,
        explanation,
        component_mapping: componentMapping,
      }),
    );
    mermaidCode = stripMermaidCodeFences(repaired);
    validation = await validateMermaid(mermaidCode);
  }

  if (!validation.valid) {
    throw new Error(
      `Mermaid syntax remained invalid after ${MAX_FIX_ATTEMPTS} fix attempts: ${validation.message}`,
    );
  }

  return { explanation, componentMapping, mermaidCode };
}
