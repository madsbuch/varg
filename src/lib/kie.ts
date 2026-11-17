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
import { at, numberOr, parseJson, stringOr } from "./decode";

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

function describe(code: number, msg: string | undefined): string {
  const detail = msg?.trim() ? msg : "no detail";
  if (code === 401 || code === 403) return `kie.ai rejected the API key (${code}): ${detail}`;
  if (code === 402) return `kie.ai: not enough credits (402): ${detail}`;
  if (code === 429) return `kie.ai: rate limited (429): ${detail}`;
  return `kie.ai refused the request (${code}): ${detail}`;
}

/** kie's envelope opened: `data`, still unknown, for the caller to read field by field. */
async function call(apiKey: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await httpFetch(`${KIE_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  });
  const raw = await res.text().catch(() => "");
  const parsed = parseJson(raw);
  const body = parsed.ok ? parsed.value : undefined;
  const code = numberOr(at(body, "code")) ?? res.status;
  const data = at(body, "data");
  if (!res.ok || code !== 200 || data === undefined || data === null) {
    throw new KieError(describe(code, stringOr(at(body, "msg")) ?? raw.slice(0, 200)), code);
  }
  return data;
}

/** Submit a job. Returns kie's taskId. */
export async function createTask(apiKey: string, model: string, input: Record<string, unknown>): Promise<string> {
  const data = await call(apiKey, "/api/v1/jobs/createTask", {
    method: "POST",
    body: JSON.stringify({
      model,
      // We poll for results; example.com is IANA-reserved and discards the POST.
      callBackUrl: "https://example.com/varg-kie-callback",
      input,
    }),
  });
  const taskId = stringOr(at(data, "taskId"));
  if (taskId === undefined || taskId === "") throw new KieError("kie.ai accepted the job but returned no taskId.", 500);
  return taskId;
}

export type TaskState = "waiting" | "queuing" | "generating" | "success" | "fail";
const TASK_STATES: readonly TaskState[] = ["waiting", "queuing", "generating", "success", "fail"];

export interface TaskInfo {
  state: TaskState;
  failMsg: string;
  /** Parsed result: `response` when kie sends it, else the parsed resultJson. */
  result: unknown;
}

export async function getTask(apiKey: string, taskId: string): Promise<TaskInfo> {
  const data = await call(apiKey, `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
  let result: unknown = at(data, "response") ?? null;
  const resultJson = stringOr(at(data, "resultJson"));
  if (result === null && resultJson !== undefined && resultJson !== "") {
    const parsed = parseJson(resultJson);
    result = parsed.ok ? parsed.value : null;
  }
  // "Internal Error" alone says nothing; kie's failCode tells a server fault
  // (500) from a refused input (422) or a failed generation (501).
  const failCode = at(data, "failCode");
  const codeText = typeof failCode === "number" ? failCode.toString() : (stringOr(failCode)?.trim() ?? "");
  const code = codeText === "" ? "" : ` [failCode ${codeText}]`;
  const rawState = at(data, "state");
  // A state kie adds later reads as still waiting: polling goes on, and the
  // overall timeout still ends it, in red.
  const state = TASK_STATES.find((s) => s === rawState) ?? "waiting";
  return { state, failMsg: (stringOr(at(data, "failMsg")) ?? "") + code, result };
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
    const url = stringOr(at(node, "audio_url")) ?? stringOr(at(node, "audioUrl"));
    if (url !== undefined && url !== "") {
      out.push({ url, duration: numberOr(at(node, "duration")), title: stringOr(at(node, "title")) });
      return;
    }
    const urls = at(node, "resultUrls");
    if (Array.isArray(urls)) {
      const list: readonly unknown[] = urls;
      for (const u of list) if (typeof u === "string" && u !== "") out.push({ url: u });
    }
    for (const key of ["data", "response", "sunoData", "resultObject"]) visit(at(node, key), depth + 1);
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
  if (!res.ok) throw new Error(`Download rejected (HTTP ${res.status}).`);
  return res.blob();
}
