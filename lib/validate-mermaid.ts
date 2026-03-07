import { execFile } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

export interface MermaidValidationResult {
  valid: boolean;
  message?: string;
  line?: number;
  token?: string;
  expected?: string[];
}

const SCRIPT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "backend",
  "scripts",
  "validate_mermaid.mjs",
);

export function validateMermaid(
  diagram: string,
): Promise<MermaidValidationResult> {
  return new Promise((resolve, reject) => {
    const proc = execFile(
      "node",
      [SCRIPT_PATH],
      { timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          resolve({
            valid: false,
            message: stderr || err.message || "Mermaid validation failed.",
          });
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve({
            valid: false,
            message: "Mermaid validator returned invalid JSON.",
          });
        }
      },
    );
    proc.stdin?.write(diagram);
    proc.stdin?.end();
  });
}

export function formatValidationFeedback(
  result: MermaidValidationResult,
): string {
  if (result.valid) return "No syntax errors found.";

  const details = [`message: ${result.message ?? "unknown parse error"}`];
  if (result.line != null) details.push(`line: ${result.line}`);
  if (result.token) details.push(`token: ${result.token}`);
  if (result.expected?.length) {
    details.push(`expected: ${result.expected.join(", ")}`);
  }
  return details.join("\n");
}
