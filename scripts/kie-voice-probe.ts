/**
 * Live check of kie.ai text-to-speech, outside the app.
 *
 *   KIE_API_KEY=... bun run voice:probe            # every voice model
 *   KIE_API_KEY=... bun run voice:probe elevenlabs # only models matching
 *
 * For each model it submits the exact input the app sends (speechInput)
 * for one workout line, polls it to the end and downloads the clip, then
 * prints state, failCode/failMsg and clip size. Uses real credits: a few
 * short lines per run.
 */
import { audioResults, createTask, download, getTask } from "../src/lib/kie";
import { VOICE_MODELS, speechInput, voicesFor } from "../src/lib/voice-clips";

// httpFetch picks the Tauri plugin when it sees a window; give it a plain one.
(globalThis as { window?: unknown }).window ??= globalThis;

const apiKey = process.env["KIE_API_KEY"]?.trim();
if (!apiKey) {
  console.error("Set KIE_API_KEY to the kie.ai key from the app's Settings.");
  process.exit(2);
}
const filter = process.argv[2] ?? "";
const text = "Next: Push-up";

let failed = 0;
for (const m of VOICE_MODELS.filter((x) => x.id.includes(filter))) {
  const voice = voicesFor(m.id, "workout").fallback;
  const input = speechInput(m.id, "workout", voice, text);
  process.stdout.write(`${m.id} (${voice}) … `);
  try {
    const taskId = await createTask(apiKey, m.id, input);
    let done = false;
    for (let i = 0; i < 60 && !done; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const info = await getTask(apiKey, taskId);
      if (info.state === "fail") throw new Error(`job failed: ${info.failMsg || "no reason"} (task ${taskId})`);
      if (info.state !== "success") continue;
      const url = audioResults(info.result)[0]?.url;
      if (!url) throw new Error(`success but no audio URL: ${JSON.stringify(info.result)}`);
      const blob = await download(url);
      console.log(`OK — ${String(blob.size)} bytes, ${blob.type || "no type"} (${url})`);
      done = true;
    }
    if (!done) throw new Error(`still running after two minutes (task ${taskId})`);
  } catch (e) {
    failed++;
    console.log(`FAILED — ${e instanceof Error ? e.message : String(e)}`);
    console.log(`  input: ${JSON.stringify(input)}`);
  }
}
process.exit(failed ? 1 : 0);
