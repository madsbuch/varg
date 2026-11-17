/**
 * The contract between the app and the Rust store (src-tauri/store).
 *
 * - Every built-in template survives the strict decoder unchanged, so a
 *   program saved as JSON comes back as exactly the program that was saved.
 * - What the app sends is pinned in a fixture that the Rust tests decode
 *   into the store's strict types (deny_unknown_fields, no coercion):
 *   `wire_fixture_decodes` in src-tauri/store. A change to either side that
 *   the other would refuse fails one of the two test suites.
 *   Regenerate after a deliberate change: UPDATE_FIXTURES=1 bun test scripts/store.test.ts
 * - The snapshot reader keeps every readable row and names the rest.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { seedExercises, seedTemplates } from "../src/lib/seed";
import { Reader, readChatItem, readChatMessage, readTemplate } from "../src/lib/decode";
import { chatWire, exerciseWire, programWire, prWire, sessionWire } from "../src/db/rust";
import { readSnapshot } from "../src/db/read";
import type { ChatItem, ChatMessage, Session } from "../src/types";

const json = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

describe("templates as stored", () => {
  test("every built-in round-trips through the strict decoder", () => {
    for (const t of seedTemplates()) {
      const r = new Reader();
      const back = readTemplate(r, json(t), t.id);
      expect(r.problems).toEqual([]);
      expect(json(back)).toEqual(json(t));
    }
  });

  test("a coerced or unknown value is refused", () => {
    const [first] = seedTemplates();
    if (!first) throw new Error("no templates");
    const r = new Reader();
    const raw = json(first);
    readTemplate(r, typeof raw === "object" && raw !== null ? { ...raw, level: "expert", estimateMinutes: "20" } : raw, "t");
    expect(r.problems).toContain('t.level must be one of "beginner", "intermediate", "advanced"');
    expect(r.problems).toContain("t.estimateMinutes must be a whole number");
  });
});

const session: Session = {
  id: "s1",
  name: "Varg 18",
  date: "2026-11-17T08:00:00.000Z",
  finishedAt: "2026-11-17T08:18:00.000Z",
  templateId: "tpl-varg-18",
  heartRate: { avg: 142, max: 171, every: 5, trace: [120, 150] },
  entries: [{ id: "e1", exerciseId: "ex-push-up", sets: [{ id: "w1", reps: 20, done: true }, { id: "w2", weight: 60, reps: 5, rpe: 8, done: false }] }],
};
const tpl = seedTemplates().find((t) => t.emom);
if (!tpl) throw new Error("no EMOM built-in");
const item: ChatItem = { kind: "program", template: { ...tpl, id: "mimir-x" }, saved: true };
const message: ChatMessage = {
  role: "assistant",
  content: null,
  tool_calls: [{ id: "c1", type: "function", function: { name: "get_history", arguments: "{}" } }],
};

const wire = json({
  exercises: seedExercises().map((e) => exerciseWire({ ...e, deprecated: true })),
  sessions: [sessionWire(session)],
  prs: [prWire({ id: "p", exerciseId: "ex-push-up", kind: "1rm", value: 100.5, reps: 5, date: "2026-11-01", manual: true })],
  programs: [programWire({ id: "mimir-x", template: { ...tpl, id: "mimir-x" }, savedAt: "2026-11-17" })],
  mimirItems: [chatWire({ id: "i", seq: 1, body: item })],
  mimirMessages: [chatWire({ id: "m", seq: 1, body: message })],
  problems: [],
});

describe("the bridge", () => {
  const path = join(import.meta.dir, "..", "src-tauri", "store", "tests", "fixtures", "wire.json");
  test("the fixture the Rust tests decode is what the app sends", () => {
    const text = `${JSON.stringify(wire, null, 2)}\n`;
    if (process.env["UPDATE_FIXTURES"] === "1") writeFileSync(path, text);
    expect(readFileSync(path, "utf8")).toBe(text);
  });

  test("the app reads back what it sends", () => {
    const { data, problems } = readSnapshot(wire);
    expect(problems).toEqual([]);
    expect(json(data.sessions)).toEqual(json([session]));
    expect(data.exercises.length).toBe(seedExercises().length);
    const r = new Reader();
    expect(json(readChatItem(r, json(item), "item"))).toEqual(json(item));
    expect(json(readChatMessage(r, json(message), "message"))).toEqual(json(message));
    expect(r.problems).toEqual([]);
  });

  test("an unreadable row is named; the rest loads", () => {
    const broken = json(wire);
    if (typeof broken !== "object" || broken === null || !("sessions" in broken) || !Array.isArray(broken.sessions)) throw new Error("fixture shape");
    broken.sessions.push({ id: "bad", name: "x", date: "d", entries: [{ id: "e", exerciseId: "x", sets: [{ id: "w", reps: "5", done: true }] }] });
    const { data, problems } = readSnapshot(broken);
    expect(data.sessions.length).toBe(1);
    expect(problems).toEqual(["sessions[1].entries[0].sets[0].reps must be a whole number"]);
  });
});
