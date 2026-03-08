import { getModel } from "~/server/generate/model-config";
import {
  extractComponentMapping,
  stripMermaidCodeFences,
  toTaggedMessage,
} from "~/server/generate/format";
import { getLocalData } from "~/server/generate/local";
import {
  estimateTokens,
  streamCompletion,
} from "~/server/generate/openai";
import {
  SYSTEM_FIRST_PROMPT,
  SYSTEM_FIX_MERMAID_PROMPT,
  SYSTEM_SECOND_PROMPT,
  SYSTEM_THIRD_PROMPT,
} from "~/server/generate/prompts";
import {
  formatValidationFeedback,
  validateMermaidSyntax,
} from "~/server/generate/mermaid";
import { sseMessage } from "~/server/generate/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const MAX_MERMAID_FIX_ATTEMPTS = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(_request: Request) {
  const localPath = process.env.LOCAL_ANALYSIS_PATH;

  if (!localPath) {
    return new Response(
      JSON.stringify({ ok: false, error: "LOCAL_ANALYSIS_PATH is not configured." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseMessage(payload)));
      };

      const run = async () => {
        try {
          const localData = await getLocalData(localPath);
          const model = getModel();
          const tokenCount = estimateTokens(
            `${localData.fileTree}\n${localData.readme}`,
          );

          send({
            status: "started",
            message: `Analyzing local directory (${tokenCount} estimated tokens)...`,
          });

          // Stage 1: Explanation
          send({
            status: "explanation_sent",
            message: `Sending explanation request to ${model}...`,
          });
          await sleep(80);
          send({
            status: "explanation",
            message: "Analyzing project structure...",
          });

          let explanation = "";
          for await (const chunk of streamCompletion({
            model,
            systemPrompt: SYSTEM_FIRST_PROMPT,
            userPrompt: toTaggedMessage({
              file_tree: localData.fileTree,
              readme: localData.readme,
            }),
          })) {
            explanation += chunk;
            send({ status: "explanation_chunk", chunk });
          }

          // Stage 2: Component Mapping
          send({
            status: "mapping_sent",
            message: `Sending component mapping request to ${model}...`,
          });
          await sleep(80);
          send({
            status: "mapping",
            message: "Creating component mapping...",
          });

          let fullMappingResponse = "";
          for await (const chunk of streamCompletion({
            model,
            systemPrompt: SYSTEM_SECOND_PROMPT,
            userPrompt: toTaggedMessage({
              explanation,
              file_tree: localData.fileTree,
            }),
          })) {
            fullMappingResponse += chunk;
            send({ status: "mapping_chunk", chunk });
          }

          const componentMapping =
            extractComponentMapping(fullMappingResponse);

          // Stage 3: Mermaid Diagram
          send({
            status: "diagram_sent",
            message: `Sending diagram generation request to ${model}...`,
          });
          await sleep(80);
          send({
            status: "diagram",
            message: "Generating diagram...",
          });

          let mermaidCode = "";
          for await (const chunk of streamCompletion({
            model,
            systemPrompt: SYSTEM_THIRD_PROMPT,
            userPrompt: toTaggedMessage({
              explanation,
              component_mapping: componentMapping,
            }),
          })) {
            mermaidCode += chunk;
            send({ status: "diagram_chunk", chunk });
          }

          let candidateDiagram = stripMermaidCodeFences(mermaidCode);
          let validationResult =
            await validateMermaidSyntax(candidateDiagram);
          const hadFixLoop = !validationResult.valid;

          if (!validationResult.valid) {
            const parserFeedback =
              formatValidationFeedback(validationResult);
            send({
              status: "diagram_fixing",
              message:
                "Diagram generated. Mermaid syntax validation failed, starting auto-fix loop...",
              parser_error: parserFeedback,
            });
          }

          for (
            let attempt = 1;
            !validationResult.valid &&
            attempt <= MAX_MERMAID_FIX_ATTEMPTS;
            attempt++
          ) {
            const parserFeedback =
              formatValidationFeedback(validationResult);
            send({
              status: "diagram_fix_attempt",
              message: `Fixing Mermaid syntax (attempt ${attempt}/${MAX_MERMAID_FIX_ATTEMPTS})...`,
              fix_attempt: attempt,
              fix_max_attempts: MAX_MERMAID_FIX_ATTEMPTS,
              parser_error: parserFeedback,
            });

            let repairedDiagram = "";
            for await (const chunk of streamCompletion({
              model,
              systemPrompt: SYSTEM_FIX_MERMAID_PROMPT,
              userPrompt: toTaggedMessage({
                mermaid_code: candidateDiagram,
                parser_error: parserFeedback,
                explanation,
                component_mapping: componentMapping,
              }),
            })) {
              repairedDiagram += chunk;
              send({
                status: "diagram_fix_chunk",
                chunk,
                fix_attempt: attempt,
                fix_max_attempts: MAX_MERMAID_FIX_ATTEMPTS,
              });
            }

            candidateDiagram = stripMermaidCodeFences(repairedDiagram);
            send({
              status: "diagram_fix_validating",
              message: `Validating Mermaid syntax after attempt ${attempt}/${MAX_MERMAID_FIX_ATTEMPTS}...`,
              fix_attempt: attempt,
              fix_max_attempts: MAX_MERMAID_FIX_ATTEMPTS,
            });
            validationResult =
              await validateMermaidSyntax(candidateDiagram);
          }

          if (!validationResult.valid) {
            send({
              status: "error",
              error:
                "Generated Mermaid remained syntactically invalid after auto-fix attempts. Please retry generation.",
              error_code: "MERMAID_SYNTAX_UNRESOLVED",
              parser_error: formatValidationFeedback(validationResult),
            });
            return;
          }

          // For local paths, don't process click events to GitHub URLs
          // Just keep the raw paths
          const processedDiagram = candidateDiagram;

          if (hadFixLoop) {
            send({
              status: "diagram_fixing",
              message:
                "Mermaid syntax validated. Finalizing diagram output...",
            });
          }

          send({
            status: "complete",
            diagram: processedDiagram,
            explanation,
            mapping: componentMapping,
          });
        } catch (error) {
          send({
            status: "error",
            error:
              error instanceof Error
                ? error.message
                : "Streaming generation failed.",
            error_code: "STREAM_FAILED",
          });
        } finally {
          controller.close();
        }
      };

      void run();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
