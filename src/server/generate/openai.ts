import { DefaultAzureCredential } from "@azure/identity";
import OpenAI from "openai";

export type ReasoningEffort = "low" | "medium" | "high";

const credential = new DefaultAzureCredential();
let cachedToken: { token: string; expiresOnTimestamp: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresOnTimestamp > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const result = await credential.getToken(
    "https://cognitiveservices.azure.com/.default",
  );
  cachedToken = result;
  return result.token;
}

async function getClient(): Promise<OpenAI> {
  const baseURL =
    process.env.AZURE_OPENAI_BASE_URL ??
    `${process.env.AZURE_OPENAI_ENDPOINT}/openai/v1`;

  if (!baseURL || baseURL === "undefined/openai/v1") {
    throw new Error(
      "Missing AZURE_OPENAI_BASE_URL or AZURE_OPENAI_ENDPOINT env var.",
    );
  }

  const token = await getToken();
  return new OpenAI({ apiKey: token, baseURL });
}

function getModel(): string {
  return process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-5.4";
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface StreamCompletionParams {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  apiKey?: string;
  reasoningEffort?: ReasoningEffort;
  maxOutputTokens?: number;
}

export async function* streamCompletion({
  systemPrompt,
  userPrompt,
}: StreamCompletionParams): AsyncGenerator<string, void, void> {
  const client = await getClient();

  const stream = await client.chat.completions.create({
    model: getModel(),
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      yield delta;
    }
  }
}

interface CountInputTokensParams {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  apiKey?: string;
  reasoningEffort?: ReasoningEffort;
}

export async function countInputTokens({
  systemPrompt,
  userPrompt,
}: CountInputTokensParams): Promise<number> {
  // Azure OpenAI doesn't have a token counting endpoint,
  // fall back to estimation
  return estimateTokens(systemPrompt + userPrompt);
}
