/**
 * Core types for the gitdiagram analysis pipeline.
 */

/** Result of a complete local analysis. */
export interface AnalysisResult {
  explanation: string;
  componentMapping: string;
  mermaidCode: string;
}

/** Options for analyzeLocal(). */
export interface AnalyzeLocalOptions {
  /** Absolute path to the directory to analyze. */
  path: string;

  /**
   * LLM completion function. The pipeline calls this for each stage.
   * Callers provide their own implementation (OpenAI, Azure OpenAI, etc.).
   */
  complete: CompletionFn;

  /**
   * Optional callback for progress updates.
   */
  onProgress?: (stage: AnalysisStage, message: string) => void;
}

/** Stages reported via onProgress. */
export type AnalysisStage =
  | "scanning"
  | "explanation"
  | "mapping"
  | "diagram"
  | "validating"
  | "fixing";

/**
 * An LLM completion function that the caller provides.
 * Takes a system prompt and user prompt, returns the full response text.
 */
export type CompletionFn = (
  systemPrompt: string,
  userPrompt: string,
) => Promise<string>;
