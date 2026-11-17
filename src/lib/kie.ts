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
import { z } from "zod";
import { parseAs, parseJsonAs } from "./schema";

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

/** kie's envelope: its own status code and message around the `data`. */
const EnvelopeSchema = z.object({ code: z.int().nullish(), msg: z.string().nullish(), data: z.unknown() });

/** What createTask answers. */
const CreatedSchema = z.object({ taskId: z.string().min(1) });

/** What recordInfo answers, as far as Varg reads it. */
const RecordSchema = z.object({
  state: z.string().nullish(),
  failCode: z.union([z.string(), z.number()]).nullish(),
  failMsg: z.string().nullish(),
  resultJson: z.string().nullish(),
  response: z.unknown(),
});

/**
 * Call kie and read its `data` as `schema`. Anything else (another code, no
 * data, a data of the wrong shape) is a KieError carrying kie's own words.
 */
async function call<S extends z.ZodType>(apiKey: string, path: string, schema: S, init: RequestInit = {}): Promise<z.infer<S>> {
  const res = await httpFetch(`${KIE_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  });
  const raw = await res.text().catch(() => "");
  const envelope = parseJsonAs(EnvelopeSchema, raw, "kie");
  const body = envelope.ok ? envelope.value : undefined;
  const code = body?.code ?? res.status;
  if (!res.ok || code !== 200 || body?.data === undefined || body.data === null) {
    throw new KieError(describe(code, body?.msg ?? raw.slice(0, 200)), code);
  }
  const data = parseAs(schema, body.data, "kie data");
  if (!data.ok) throw new KieError(`kie.ai answered in an unexpected shape: ${data.problems.slice(0, 3).join("; ")}`, 500);
  return data.value;
}

/** Submit a job. Returns kie's taskId. */
export async function createTask(apiKey: string, model: string, input: Record<string, unknown>): Promise<string> {
  const data = await call(apiKey, "/api/v1/jobs/createTask", CreatedSchema, {
    method: "POST",
    body: JSON.stringify({
      model,
      // We poll for results; example.com is IANA-reserved and discards the POST.
      callBackUrl: "https://example.com/varg-kie-callback",
      input,
    }),
  });
  return data.taskId;
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
  const data = await call(apiKey, `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, RecordSchema);
  let result: unknown = data.response ?? null;
  if (result === null && data.resultJson !== undefined && data.resultJson !== null && data.resultJson !== "") {
    // Read as a value only: audioResults reads each node of it by schema.
    const parsed = parseJsonAs(z.unknown(), data.resultJson, "resultJson");
    result = parsed.ok ? parsed.value : null;
  }
  // "Internal Error" alone says nothing; kie's failCode tells a server fault
  // (500) from a refused input (422) or a failed generation (501).
  const failCode = data.failCode;
  const codeText = typeof failCode === "number" ? failCode.toString() : (failCode?.trim() ?? "");
  const code = codeText === "" ? "" : ` [failCode ${codeText}]`;
  // A state kie adds later reads as still waiting: polling goes on, and the
  // overall timeout still ends it, in red.
  const state = TASK_STATES.find((s) => s === data.state) ?? "waiting";
  return { state, failMsg: (data.failMsg ?? "") + code, result };
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
    if (depth > 4) return;
    const list = z.array(z.unknown()).safeParse(node);
    if (list.success) {
      for (const n of list.data) visit(n, depth + 1);
      return;
    }
    const o = ResultNodeSchema.safeParse(node);
    if (!o.success) return; // a string, a number, a node of another shape: no audio here
    const url = o.data.audio_url ?? o.data.audioUrl;
    if (url !== undefined && url !== null && url !== "") {
      out.push({ url, duration: o.data.duration ?? undefined, title: o.data.title ?? undefined });
      return;
    }
    for (const u of o.data.resultUrls ?? []) if (u !== "") out.push({ url: u });
    for (const child of [o.data.data, o.data.response, o.data.sunoData, o.data.resultObject]) visit(child, depth + 1);
  };
  visit(result, 0);
  return out;
}

/** One node of a finished job's result, as far as audio is concerned. */
const ResultNodeSchema = z.object({
  audio_url: z.string().nullish(),
  audioUrl: z.string().nullish(),
  duration: z.number().nullish(),
  title: z.string().nullish(),
  resultUrls: z.array(z.string()).nullish(),
  data: z.unknown(),
  response: z.unknown(),
  sunoData: z.unknown(),
  resultObject: z.unknown(),
});

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
