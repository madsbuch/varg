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
import { parseJson, Reader, readChatMessage } from "./decode";
import { kvGet, kvSet } from "./kv";

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
  const raw = kvGet(SETTINGS_KEY);
  const parsed = raw === null ? undefined : parseJson(raw);
  if (!parsed?.ok) return { apiKey: "", model: DEFAULT_MODEL };
  const r = new Reader();
  const f = r.obj(parsed.value, "settings");
  const apiKey = f.get("apiKey");
  const model = f.get("model");
  return {
    apiKey: typeof apiKey === "string" ? apiKey : "",
    model: typeof model === "string" && model.trim() !== "" ? model : DEFAULT_MODEL,
  };
}

export function saveMimirSettings(s: MimirSettings): void {
  kvSet(SETTINGS_KEY, JSON.stringify({ apiKey: s.apiKey.trim(), model: s.model.trim() || DEFAULT_MODEL }));
}

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

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
  const parsed = parseJson(raw);
  const r = new Reader();
  const body = parsed.ok ? r.obj(parsed.value, "response") : new Map<string, unknown>();
  const error = r.optObj(body.get("error"), "response.error");
  if (!res.ok || error) {
    const message = error?.get("message");
    const code = error?.get("code");
    const detail = typeof message === "string" ? message : raw.slice(0, 200) || "no detail";
    const status = res.ok ? (typeof code === "number" ? code : 500) : res.status;
    const what =
      status === 401 ? "OpenRouter rejected the key"
        : status === 402 ? "OpenRouter: out of credits"
          : status === 429 ? "OpenRouter: rate limited"
            : `OpenRouter refused (${status})`;
    throw new OpenRouterError(`${what}: ${detail}`, status);
  }
  if (!parsed.ok) throw new OpenRouterError(`OpenRouter answered with something that is not JSON: ${raw.slice(0, 200)}`, 500);
  const first = r.arr(body.get("choices"), "response.choices")[0];
  const choice = r.obj(first, "response.choices[0]");
  const msg = readChatMessage(r, choice.get("message"), "response.choices[0].message");
  if (!r.ok()) throw new OpenRouterError(`OpenRouter answered in an unexpected shape: ${r.problems.join("; ")}`, 500);
  if (msg.role !== "assistant") throw new OpenRouterError(`OpenRouter answered as "${msg.role}", not the assistant`, 500);
  return msg;
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
  const parsed = parseJson(await res.text());
  if (!parsed.ok) throw new Error(`Model list: ${parsed.error}`);
  const r = new Reader();
  const out: ModelInfo[] = [];
  for (const [i, m] of r.arr(r.obj(parsed.value, "models").get("data"), "models.data").entries()) {
    const f = r.obj(m, `models.data[${i}]`);
    const id = r.str(f.get("id"), `models.data[${i}].id`);
    const params = f.get("supported_parameters");
    const tools = Array.isArray(params) && params.some((p) => p === "tools");
    if (!tools || id.endsWith(":batch")) continue;
    const name = f.get("name");
    const pricing = r.optObj(f.get("pricing"), `models.data[${i}].pricing`);
    const prompt = pricing?.get("prompt");
    // OpenRouter sends prices as decimal strings; a string that is not a
    // number leaves the price unknown rather than guessing one.
    const perToken = typeof prompt === "string" && /^\d+(\.\d+)?(e-?\d+)?$/i.test(prompt) ? Number.parseFloat(prompt) : undefined;
    out.push({ id, name: typeof name === "string" ? name : id, promptPerM: perToken === undefined ? undefined : perToken * 1e6 });
  }
  if (!r.ok()) throw new Error(`Model list: ${r.problems.join("; ")}`);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
