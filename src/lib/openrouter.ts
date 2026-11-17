/**
 * OpenRouter: the LLM gateway behind Mímir, the in-app trainer. One key, any
 * model; the owner picks the model in Skipan → Mímir.
 *
 * OpenAI-style chat completions with tool calls, non-streaming: Mímir's
 * turns are short and every tool result has to land before the next call
 * anyway. Thin and loud like kie.ts: every refusal carries OpenRouter's own
 * message, never a generic "failed". Every answer is decoded strictly
 * (decode.ts) before the app uses any of it.
 */
import type { ChatMessage } from "../types";
import { errorText, httpFetch } from "./http";
import { z } from "zod";
import { parseJsonAs } from "./schema";
import { kvRead, kvSet } from "./kv";

const BASE = "https://openrouter.ai/api/v1";
const SETTINGS_KEY = "varg.mimir.settings.v1";

/** Tool-capable and good at structured output; the owner can pick any other. */
export const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";

export interface MimirSettings {
  apiKey: string;
  model: string;
}

/** The stored settings. Unreadable or missing fields fall back, field by field. */
export function loadMimirSettings(): MimirSettings {
  const stored = kvRead(SETTINGS_KEY, z.strictObject({ apiKey: z.string(), model: z.string() }));
  return {
    apiKey: stored?.apiKey ?? "",
    model: stored !== undefined && stored.model.trim() !== "" ? stored.model : DEFAULT_MODEL,
  };
}

export function saveMimirSettings(s: MimirSettings): void {
  kvSet(SETTINGS_KEY, JSON.stringify({ apiKey: s.apiKey.trim(), model: s.model.trim() || DEFAULT_MODEL }));
}

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/*
 * OpenRouter's answers, as far as Varg reads them. Not strict: OpenRouter
 * adds fields (refusal, reasoning, usage…) that Varg has no use for; every
 * field that is read is typed, and the message is copied into the stored
 * shape field by field.
 */
const ErrorAnswerSchema = z.object({
  error: z.object({ message: z.string().nullish(), code: z.union([z.number(), z.string()]).nullish() }).nullish(),
});
const AnswerSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        role: z.literal("assistant"),
        content: z.string().nullish(),
        tool_calls: z
          .array(z.object({ id: z.string().min(1), type: z.literal("function"), function: z.object({ name: z.string().min(1), arguments: z.string() }) }))
          .nullish(),
      }),
    }),
  ),
});
const ModelListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().nullish(),
      supported_parameters: z.array(z.string()).nullish(),
      pricing: z.object({ prompt: z.string().nullish() }).nullish(),
    }),
  ),
});

export class OpenRouterError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type AssistantMessage = Extract<ChatMessage, { role: "assistant" }>;

/** One completion. Returns the assistant message as it should go back into the history. */
export async function complete(
  settings: MimirSettings,
  messages: ChatMessage[],
  tools: ToolSpec[],
  signal?: AbortSignal,
): Promise<AssistantMessage> {
  if (settings.apiKey.trim() === "") throw new OpenRouterError("No OpenRouter key · Skipan → Mímir", 401);
  const res = await httpFetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey.trim()}`,
      "Content-Type": "application/json",
      "X-Title": "Varg",
    },
    body: JSON.stringify({ model: settings.model, messages, tools, tool_choice: "auto" }),
    signal: signal ?? null,
  });
  const raw = await res.text().catch(() => "");
  const failed = parseJsonAs(ErrorAnswerSchema, raw, "response");
  const error = failed.ok ? failed.value.error : undefined;
  if (!res.ok || error) {
    const detail = error?.message ?? (raw.slice(0, 200) || "no detail");
    const status = res.ok ? (typeof error?.code === "number" ? error.code : 500) : res.status;
    const what =
      status === 401 ? "OpenRouter rejected the key"
        : status === 402 ? "OpenRouter: out of credits"
          : status === 429 ? "OpenRouter: rate limited"
            : `OpenRouter refused (${status})`;
    throw new OpenRouterError(`${what}: ${detail}`, status);
  }
  const answer = parseJsonAs(AnswerSchema, raw, "response");
  if (!answer.ok) throw new OpenRouterError(`OpenRouter answered in an unexpected shape: ${answer.problems.slice(0, 3).join("; ")}`, 500);
  const first = answer.value.choices[0];
  if (!first) throw new OpenRouterError("OpenRouter answered with no choices", 500);
  const m = first.message;
  const calls = (m.tool_calls ?? []).map((c) => ({ id: c.id, type: c.type, function: { name: c.function.name, arguments: c.function.arguments } }));
  // Exactly the stored shape (ChatMessageSchema): what OpenRouter adds is dropped here.
  return calls.length > 0 ? { role: "assistant", content: m.content ?? null, tool_calls: calls } : { role: "assistant", content: m.content ?? null };
}

export interface ModelInfo {
  id: string;
  name: string;
  /** USD per million input tokens; undefined when OpenRouter lists no price. */
  promptPerM: number | undefined;
}

/** Every model on OpenRouter that can call tools (Mímir needs them). Public endpoint: no key. */
export async function listModels(): Promise<ModelInfo[]> {
  let res: Response;
  try {
    res = await httpFetch(`${BASE}/models`);
  } catch (e) {
    throw new Error(`Model list: ${errorText(e)}`);
  }
  if (!res.ok) throw new Error(`Model list: HTTP ${res.status}`);
  const parsed = parseJsonAs(ModelListSchema, await res.text(), "models");
  if (!parsed.ok) throw new Error(`Model list: ${parsed.problems.slice(0, 3).join("; ")}`);
  const out: ModelInfo[] = [];
  for (const m of parsed.value.data) {
    const tools = m.supported_parameters?.includes("tools") === true;
    if (!tools || m.id.endsWith(":batch")) continue;
    const prompt = m.pricing?.prompt;
    // OpenRouter sends prices as decimal strings; one that is not a plain
    // decimal leaves the price unknown rather than guessing one.
    const perToken = prompt !== undefined && prompt !== null && /^\d+(\.\d+)?$/.test(prompt) ? Number.parseFloat(prompt) : undefined;
    out.push({ id: m.id, name: m.name ?? m.id, promptPerM: perToken === undefined ? undefined : perToken * 1e6 });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
