/**
 * OpenRouter: the LLM gateway behind Mímir, the in-app trainer. One key, any
 * model; the owner picks the model in Skipan → Mímir.
 *
 * OpenAI-style chat completions with tool calls, non-streaming: Mímir's
 * turns are short and every tool result has to land before the next call
 * anyway. Thin and loud like kie.ts: every refusal carries OpenRouter's own
 * message, never a generic "failed".
 */
import { errorText, httpFetch } from "./http";

const BASE = "https://openrouter.ai/api/v1";
const SETTINGS_KEY = "varg.mimir.settings.v1";

/** Tool-capable and good at structured output; the owner can pick any other. */
export const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";

export interface MimirSettings {
  apiKey: string;
  model: string;
}

export function loadMimirSettings(): MimirSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<MimirSettings>) : {};
    return {
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      model: typeof parsed.model === "string" && parsed.model.trim() ? parsed.model : DEFAULT_MODEL,
    };
  } catch {
    return { apiKey: "", model: DEFAULT_MODEL };
  }
}

export function saveMimirSettings(s: MimirSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ apiKey: s.apiKey.trim(), model: s.model.trim() || DEFAULT_MODEL }));
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] | undefined }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export class OpenRouterError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

interface CompletionBody {
  choices?: { message?: { content?: string | null; tool_calls?: { type?: unknown }[] }; finish_reason?: string }[];
  error?: { message?: string; code?: number | string };
}

/** One completion. Returns the assistant message as it should go back into the history. */
export async function complete(
  settings: MimirSettings,
  messages: ChatMessage[],
  tools: ToolSpec[],
  signal?: AbortSignal,
): Promise<Extract<ChatMessage, { role: "assistant" }>> {
  if (!settings.apiKey.trim()) throw new OpenRouterError("No OpenRouter key · Skipan → Mímir", 401);
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
  let body: CompletionBody | null = null;
  try {
    body = JSON.parse(raw) as CompletionBody;
  } catch {
    // reported below
  }
  if (!res.ok || body?.error) {
    const detail = body?.error?.message ?? (raw.slice(0, 200) || "no detail");
    const status = res.ok ? Number(body?.error?.code) || 500 : res.status;
    const what =
      status === 401 ? "OpenRouter rejected the key"
        : status === 402 ? "OpenRouter: out of credits"
          : status === 429 ? "OpenRouter: rate limited"
            : `OpenRouter refused (${String(status)})`;
    throw new OpenRouterError(`${what}: ${detail}`, status);
  }
  const msg = body?.choices?.[0]?.message;
  if (!msg) throw new OpenRouterError(`OpenRouter returned no message: ${raw.slice(0, 200)}`, 500);
  const calls = msg.tool_calls?.filter((c): c is ToolCall => c.type === "function");
  return { role: "assistant", content: msg.content ?? null, ...(calls?.length ? { tool_calls: calls } : {}) };
}

export interface ModelInfo {
  id: string;
  name: string;
  /** USD per million input tokens. */
  promptPerM: number;
}

/** Every model on OpenRouter that can call tools (Mímir needs them). Public endpoint: no key. */
export async function listModels(): Promise<ModelInfo[]> {
  let res: Response;
  try {
    res = await httpFetch(`${BASE}/models`);
  } catch (e) {
    throw new Error(`Model list: ${errorText(e)}`);
  }
  if (!res.ok) throw new Error(`Model list: HTTP ${String(res.status)}`);
  const body = (await res.json()) as { data?: { id: string; name?: string; supported_parameters?: string[]; pricing?: { prompt?: string } }[] };
  return (body.data ?? [])
    .filter((m) => m.supported_parameters?.includes("tools") && !m.id.endsWith(":batch"))
    .map((m) => ({ id: m.id, name: m.name ?? m.id, promptPerM: Number(m.pricing?.prompt ?? 0) * 1e6 }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
