/**
 * The contract between the app and the Rust store (src-tauri/store): the
 * zod schemas (src/lib/schema.ts) and the serde types (model.rs) describe
 * the same JSON.
 *
 * - Every built-in template survives the schema unchanged, so a program
 *   saved as JSON comes back as exactly the program that was saved.
 * - What the app sends (every built-in as a program, every chat kind and
 *   role, a session, a record) is pinned in wire.json, and every enum's
 *   values in enums.json. The Rust tests decode both into the strict serde
 *   types (`wire_fixture_decodes_and_round_trips`, `enums_match_the_app`).
 *   A change to either side that the other would refuse fails one suite.
 *   Regenerate after a deliberate change: UPDATE_FIXTURES=1 bun test scripts/store.test.ts
 * - The snapshot reader keeps every readable row and names the rest.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { seedExercises, seedTemplates } from "../src/lib/seed";
import {
  CategorySchema,
  ChatItemSchema,
  ChatMessageSchema,
  GearIdSchema,
  LevelSchema,
  MetricSchema,
  parseAs,
  parseJsonAs,
  PerSideSchema,
  PlanSchema,
  PRKindSchema,
  SetIdSchema,
  SideSchema,
  TemplateSchema,
} from "../src/lib/schema";
import { chatWire, exerciseWire, programWire, prWire, sessionWire } from "../src/db/rust";
import { readSnapshot } from "../src/db/read";
import type { ChatItem, ChatMessage, Session } from "../src/types";
import { must } from "./must";

/** A value as it comes back from JSON: undefined fields gone. */
const json = (v: unknown): unknown => {
  const parsed = parseJsonAs(z.unknown(), JSON.stringify(v), "value");
  if (!parsed.ok) throw new Error(parsed.problems.join("; "));
  return parsed.value;
};

const FIXTURES = join(import.meta.dir, "..", "src-tauri", "store", "tests", "fixtures");
function pinned(name: string, value: unknown): void {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const path = join(FIXTURES, name);
  if (process.env["UPDATE_FIXTURES"] === "1") writeFileSync(path, text);
  expect(readFileSync(path, "utf8")).toBe(text);
}

describe("templates as stored", () => {
  test("every built-in round-trips through the schema", () => {
    for (const t of seedTemplates()) {
      const back = parseAs(TemplateSchema, json(t), t.id);
      expect(back.ok ? [] : back.problems).toEqual([]);
      if (back.ok) expect(json(back.value)).toEqual(json(t));
    }
  });

  test("a coerced, unknown or extra value is refused, with its path", () => {
    const first = must(seedTemplates()[0]);
    const raw = json(first);
    const bad = typeof raw === "object" && raw !== null ? { ...raw, level: "expert", interval: { work: 20 } } : raw;
    const r = parseAs(TemplateSchema, bad, "t");
    expect(r.ok).toBe(false);
    const problems = r.ok ? [] : r.problems.join("\n");
    expect(problems).toContain("t.level");
    expect(problems).toContain("interval");
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
const emomTpl = must(seedTemplates().find((t) => t.plan.kind === "emom"));
const items: ChatItem[] = [
  { kind: "user", text: "Build me a circuit" },
  { kind: "mimir", text: "Building it." },
  { kind: "error", text: "Stopped after 10 steps" },
  { kind: "pick", templateId: "tpl-varg-18", why: "Fresh legs." },
  { kind: "program", template: { ...emomTpl, id: "mimir-x" }, saved: true },
  { kind: "program", template: { ...emomTpl, id: "mimir-y" }, replaces: "mimir-x" },
];
const messages: ChatMessage[] = [
  { role: "system", content: "You are Mímir." },
  { role: "user", content: "What should I train today?" },
  { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_history", arguments: "{}" } }] },
  { role: "tool", tool_call_id: "c1", content: "{\"days\":42}" },
  { role: "assistant", content: "Varg 18 today." },
];

// Every built-in as a program: every plan kind and every optional field
// the content uses crosses the bridge in the fixture.
const wire = json({
  exercises: seedExercises().map((e) => exerciseWire({ ...e, deprecated: true })),
  sessions: [sessionWire(session)],
  prs: [prWire({ id: "p", exerciseId: "ex-push-up", kind: "1rm", value: 100.5, reps: 5, date: "2026-11-01", manual: true })],
  programs: seedTemplates().map((t) => programWire({ id: t.id, template: t, savedAt: "2026-11-17" })),
  mimirItems: items.map((body, i) => chatWire({ id: `i${i}`, seq: i + 1, body })),
  mimirMessages: messages.map((body, i) => chatWire({ id: `m${i}`, seq: i + 1, body })),
  problems: [],
});

describe("the bridge", () => {
  test("wire.json, which the Rust tests decode, is what the app sends", () => {
    pinned("wire.json", wire);
  });

  test("enums.json, which the Rust enums must match, lists every value", () => {
    pinned("enums.json", {
      metric: MetricSchema.options,
      category: CategorySchema.options,
      prKind: PRKindSchema.options,
      level: LevelSchema.options,
      intensity: [1, 2, 3],
      side: SideSchema.options,
      perSide: PerSideSchema.options,
      setId: SetIdSchema.options,
      gearId: GearIdSchema.options,
      planKind: PlanSchema.options.map((o) => o.shape.kind.value),
    });
  });

  test("the app reads back what it sends", () => {
    const { data, problems } = readSnapshot(wire);
    expect(problems).toEqual([]);
    expect(json(data.sessions)).toEqual(json([session]));
    expect(data.exercises.length).toBe(seedExercises().length);
    expect(data.programs.length).toBe(seedTemplates().length);
    for (const it of items) expect(parseAs(ChatItemSchema, json(it)).ok).toBe(true);
    for (const m of messages) expect(parseAs(ChatMessageSchema, json(m)).ok).toBe(true);
  });

  test("an unreadable row is named; the rest loads", () => {
    const broken = json(wire);
    if (typeof broken !== "object" || broken === null || !("sessions" in broken) || !Array.isArray(broken.sessions)) throw new Error("fixture shape");
    broken.sessions.push({ id: "bad", name: "x", date: "d", entries: [{ id: "e", exerciseId: "x", sets: [{ id: "w", reps: "5", done: true }] }] });
    const { data, problems } = readSnapshot(broken);
    expect(data.sessions.length).toBe(1);
    expect(problems.length).toBe(1);
    expect(problems[0]).toStartWith("sessions[1].entries[0].sets[0].reps:");
  });
});
