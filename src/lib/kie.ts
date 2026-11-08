/**
 * kie.ai: one API key for everything Varg generates — Suno battle tracks
 * and ElevenLabs spoken cues. Both run through kie's unified jobs API:
 * create a task, then poll it until it succeeds or fails.
 *
 * The client is deliberately thin and loud. kie answers HTTP 200 even when
 * a request fails, with the real outcome in the body's `code`, so every
 * call checks that code and turns anything but 200 into an error carrying
 * kie's own message.
 */
import { errorText, httpFetch } from "./http";

export const KIE_BASE = "https://api.kie.ai";

export class KieError extends Error {
  constructor(
    message: string,
    /** kie's body code (or the HTTP status when there was no body). */
    readonly code: number,
  ) {
    super(message);
  }
  /** The key itself was refused — no point retrying anything with it. */
  get isAuth(): boolean {
    return this.code === 401 || this.code === 403;
  }
}

interface Envelope<T> {
  code?: number;
  msg?: string;
  data?: T | null;
}

function describe(code: number, msg: string | undefined): string {
  const detail = msg?.trim() ? msg : "no detail";
  if (code === 401 || code === 403) return `kie.ai rejected the API key (${String(code)}): ${detail}`;
  if (code === 402) return `kie.ai: not enough credits (402): ${detail}`;
  if (code === 429) return `kie.ai: rate limited (429): ${detail}`;
  return `kie.ai refused the request (${String(code)}): ${detail}`;
}

async function call<T>(apiKey: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await httpFetch(`${KIE_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  });
  const raw = await res.text().catch(() => "");
  let body: Envelope<T> | null = null;
  try {
    body = JSON.parse(raw) as Envelope<T>;
  } catch {
    // not JSON — reported below
  }
  const code = body?.code ?? res.status;
  if (!res.ok || code !== 200 || body?.data == null) {
    throw new KieError(describe(code, body?.msg ?? raw.slice(0, 200)), code);
  }
  return body.data;
}

/** Submit a job. Returns kie's taskId. */
export async function createTask(apiKey: string, model: string, input: Record<string, unknown>): Promise<string> {
  const data = await call<{ taskId?: string }>(apiKey, "/api/v1/jobs/createTask", {
    method: "POST",
    body: JSON.stringify({
      model,
      // We poll for results; example.com is IANA-reserved and discards the POST.
      callBackUrl: "https://example.com/varg-kie-callback",
      input,
    }),
  });
  if (!data.taskId) throw new KieError("kie.ai accepted the job but returned no taskId.", 500);
  return data.taskId;
}

export type TaskState = "waiting" | "queuing" | "generating" | "success" | "fail";

export interface TaskInfo {
  state: TaskState;
  failMsg: string;
  /** Parsed result: `response` when kie sends it, else the parsed resultJson. */
  result: unknown;
}

export async function getTask(apiKey: string, taskId: string): Promise<TaskInfo> {
  const data = await call<{ state?: TaskState; failCode?: string | number | null; failMsg?: string | null; resultJson?: string | null; response?: unknown }>(
    apiKey,
    `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
  );
  let result: unknown = data.response ?? null;
  if (result == null && data.resultJson) {
    try {
      result = JSON.parse(data.resultJson);
    } catch {
      result = null;
    }
  }
  // "Internal Error" alone says nothing; kie's failCode tells a server fault
  // (500) from a refused input (422) or a failed generation (501).
  const code = data.failCode != null && String(data.failCode).trim() ? ` [failCode ${String(data.failCode)}]` : "";
  return { state: data.state ?? "waiting", failMsg: (data.failMsg ?? "") + code, result };
}

export interface AudioResult {
  url: string;
  duration?: number | undefined;
  title?: string | undefined;
}

/**
 * Every audio file in a finished job. Suno jobs list their tracks as
 * `data[]` items with `audio_url`; plain media jobs (speech) as
 * `resultUrls`. Both shapes, and camelCase variants, are accepted — an
 * unrecognised shape yields nothing, which the caller reports as an error.
 */
export function audioResults(result: unknown): AudioResult[] {
  const out: AudioResult[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 4 || node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, depth + 1);
      return;
    }
    const o = node as Record<string, unknown>;
    const url = o["audio_url"] ?? o["audioUrl"];
    if (typeof url === "string" && url) {
      out.push({
        url,
        duration: typeof o["duration"] === "number" ? o["duration"] : undefined,
        title: typeof o["title"] === "string" ? o["title"] : undefined,
      });
      return;
    }
    const urls = o["resultUrls"];
    if (Array.isArray(urls)) {
      for (const u of urls) if (typeof u === "string" && u) out.push({ url: u });
    }
    for (const key of ["data", "response", "sunoData", "resultObject"]) visit(o[key], depth + 1);
  };
  visit(result, 0);
  return out;
}

/** Download a finished file, with the URL in the error if it fails. */
export async function download(url: string): Promise<Blob> {
  let res: Response;
  try {
    res = await httpFetch(url);
  } catch (e) {
    throw new Error(`Download failed: ${errorText(e)}`);
  }
  if (!res.ok) throw new Error(`Download rejected (HTTP ${String(res.status)}).`);
  return res.blob();
}
