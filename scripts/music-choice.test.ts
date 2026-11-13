import { beforeEach, describe, expect, test } from "bun:test";

// The library and the choices live in localStorage: an in-memory one here.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

const { addUserSong, allSongs, BUILT_IN_SONGS, deleteUserSong, newSongProblem, normaliseLyrics, SETS, songsIn } = await import("../src/lib/songs");
const { loadMixChoice, missingIntensities, resolveMix, saveMixChoice, setMix } = await import("../src/lib/music-choice");

beforeEach(() => { store.clear(); });

describe("song sets", () => {
  test("every set plays every intensity from its built-in songs, two each", () => {
    for (const set of SETS) {
      for (const l of [1, 2, 3] as const) expect(songsIn(set.id, l).length).toBe(2);
    }
  });
  test("a set's mix is its songs by intensity and nothing else", () => {
    const mix = setMix("jazz-house");
    for (const l of [1, 2, 3] as const) {
      for (const id of mix[l]) {
        const s = BUILT_IN_SONGS.find((x) => x.id === id);
        expect(s?.set).toBe("jazz-house");
        expect(s?.intensity).toBe(l);
      }
    }
  });
});

describe("the owner's songs", () => {
  test("a new song takes its tempo from the set, and joins the set's mix", () => {
    const s = addUserSong({ name: "Midnight brass", set: "jazz-house", intensity: 3, style: "deep house, warm saxophone, rolling bass" });
    expect(s.bpm).toBe(156);
    expect(s.user).toBe(true);
    expect(s.id.startsWith("user-")).toBe(true);
    expect(setMix("jazz-house")[3]).toContain(s.id);
    expect(allSongs().length).toBe(BUILT_IN_SONGS.length + 1);
  });
  test("plain lyrics get a section tag; empty lyrics are none", () => {
    expect(normaliseLyrics("Come on!\nCome on!")).toBe("[Verse]\nCome on!\nCome on!");
    expect(normaliseLyrics("[Chorus]\nGo")).toBe("[Chorus]\nGo");
    expect(normaliseLyrics("   ")).toBeUndefined();
  });
  test("an unfinished song is refused with a label", () => {
    expect(newSongProblem({ name: "", set: "techno", intensity: 1, style: "dark minimal techno" })).toBe("Name it");
    expect(newSongProblem({ name: "X", set: "techno", intensity: 1, style: "dark" })).toBe("Describe the sound");
    expect(() => addUserSong({ name: "", set: "techno", intensity: 1, style: "" })).toThrow();
  });
  test("deleting a song removes it from a custom choice", () => {
    const s = addUserSong({ name: "Mine", set: "techno", intensity: 2, style: "acid techno, squelchy bass" });
    const choice = { mode: "custom" as const, songs: { 1: ["low-deep-minimal"], 2: [s.id], 3: ["peak-hard-techno"] } };
    expect(resolveMix(choice, 0).mix[2]).toEqual([s.id]);
    deleteUserSong(s.id);
    expect(resolveMix(choice, 0).mix[2]).toEqual([]);
    expect(missingIntensities(choice, [1, 2, 3])).toEqual([2]);
  });
});

describe("the music choice per workout", () => {
  test("defaults to the workout's set; a saved choice wins", () => {
    expect(loadMixChoice("tpl-x", "techno")).toEqual({ mode: "set", set: "techno" });
    saveMixChoice("tpl-x", { mode: "set", set: "anthems" });
    expect(loadMixChoice("tpl-x", "techno")).toEqual({ mode: "set", set: "anthems" });
    expect(loadMixChoice("tpl-y", "techno")).toEqual({ mode: "set", set: "techno" });
  });
  test("one set per ride: a set choice plays only that set", () => {
    const { mix, set } = resolveMix({ mode: "set", set: "anthems" }, 5);
    expect(set).toBe("anthems");
    expect(mix).toEqual(setMix("anthems"));
  });
  test("shuffle: the ride's seed picks one whole set", () => {
    const sets = [0, 1, 2].map((seed) => resolveMix({ mode: "shuffle" }, seed).set);
    expect(new Set(sets).size).toBe(3);
    const { mix, set } = resolveMix({ mode: "shuffle" }, 4);
    expect(set).not.toBeNull();
    if (set) expect(mix).toEqual(setMix(set));
  });
});

const { clearMixChoice, loadDefaultChoice, loadOwnChoice, saveDefaultChoice } = await import("../src/lib/music-choice");
const { BAR_GRID_S, CHUNK_S, mainEnergy, openSections, sectionsPlan, templateSections, wodSections, workoutMix } = await import("../src/lib/workout-music");
const { seedExercises, seedTemplates } = await import("../src/lib/seed");
const { buildSteps, configForTemplate } = await import("../src/lib/wod");

describe("the default and per-workout music", () => {
  test("until a default is picked every workout plays its own track", () => {
    expect(loadDefaultChoice()).toEqual({ mode: "track" });
    expect(loadMixChoice("tpl-varg-18")).toEqual({ mode: "track" });
    expect(workoutMix("tpl-varg-18", 0)).toBeNull();
  });

  test("a default set plays everywhere without a choice of its own; a workout can override and go back", () => {
    saveDefaultChoice({ mode: "set", set: "anthems" });
    expect(loadMixChoice("tpl-varg-18")).toEqual({ mode: "set", set: "anthems" });
    expect(workoutMix("tpl-varg-18", 0)).toEqual(setMix("anthems"));
    saveMixChoice("tpl-varg-18", { mode: "track" });
    expect(workoutMix("tpl-varg-18", 0)).toBeNull();
    expect(loadMixChoice("tpl-full-body-emom-20")).toEqual({ mode: "set", set: "anthems" });
    clearMixChoice("tpl-varg-18");
    expect(loadOwnChoice("tpl-varg-18")).toBeUndefined();
    expect(loadMixChoice("tpl-varg-18")).toEqual({ mode: "set", set: "anthems" });
  });

  test("an adaptive ride has no own track: 'own track' plays its set, a default set replaces it", () => {
    expect(loadMixChoice("tpl-ride-sit-stand-accelerate", "techno")).toEqual({ mode: "set", set: "techno" });
    saveDefaultChoice({ mode: "set", set: "jazz-house" });
    expect(loadMixChoice("tpl-ride-sit-stand-accelerate", "techno")).toEqual({ mode: "set", set: "jazz-house" });
  });

  test("a stored choice naming a set that no longer exists falls back to the default", () => {
    store.set("varg.music.choice.v1", JSON.stringify({ "tpl-varg-18": { mode: "set", set: "polka" } }));
    store.set("varg.music.default.v1", JSON.stringify({ mode: "bogus" }));
    expect(loadMixChoice("tpl-varg-18")).toEqual({ mode: "track" });
  });
});

describe("music that follows the workout's shape", () => {
  const exById = new Map(seedExercises().map((e) => [e.id, e]));
  const tpl = (id: string) => seedTemplates().find((t) => t.id === id)!;
  const guided = (id: string) => {
    const cfg = configForTemplate(tpl(id), exById);
    if (typeof cfg === "string") throw new Error(cfg);
    const steps = buildSteps(cfg);
    const total = steps.reduce((a, s) => a + s.secs, 0) - steps[0]!.secs;
    return wodSections(cfg, mainEnergy(tpl(id)), total);
  };
  const origin = 1_000_000;
  const shape = (blocks: { level: number; at: number; until: number | null }[]) =>
    blocks.map((b) => [b.level, (b.at - origin) / 1000, b.until === null ? null : (b.until - origin) / 1000]);

  test("an EMOM: the warm-up Low, the 18 minutes High, a new song every two minutes", () => {
    const sections = guided("tpl-full-body-emom-20");
    expect(sections).toEqual([{ level: 1, seconds: 120 }, { level: 3, seconds: 1080 }]);
    const plan = sectionsPlan(sections, origin, 0, false);
    expect(shape(plan.blocks)).toEqual([
      [1, 0, 120],
      ...Array.from({ length: 9 }, (_, i) => [3, 120 + i * CHUNK_S, 240 + i * CHUNK_S]),
    ]);
    // The n-th block at an intensity plays the n-th song: they rotate.
    expect(plan.blocks.map((b) => b.n)).toEqual([0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // Every change lands on a whole bar at every set's tempo.
    expect(plan.blocks.every((b) => ((b.at - origin) / 1000) % BAR_GRID_S === 0)).toBe(true);
  });

  test("mid-workout the plan starts at the block playing now and keeps its numbering", () => {
    const plan = sectionsPlan(guided("tpl-full-body-emom-20"), origin, 400, false);
    expect(plan.blocks[0]).toMatchObject({ level: 3, n: 2, at: origin + 360_000 });
    expect(plan.blocks).toHaveLength(7);
    expect(sectionsPlan(guided("tpl-full-body-emom-20"), origin, 400, true).paused).toBe(true);
  });

  test("intervals play High throughout; yoga and mobility Low", () => {
    expect(guided("tpl-varg-18")).toEqual([{ level: 3, seconds: 1070 }]);
    expect(guided("tpl-varg-yoga-10")[0]?.level).toBe(1);
    expect(guided("tpl-varg-mobility-20")[0]?.level).toBe(1);
    // The last block simply ends with the workout.
    expect(shape(sectionsPlan(guided("tpl-varg-18"), origin, 0, false).blocks).at(-1)).toEqual([3, 960, 1070]);
  });

  test("for time and plain rides have no known end: booked hours ahead at one energy", () => {
    expect(openSections(mainEnergy(tpl("tpl-fran")))).toEqual([{ level: 3, seconds: null }]);
    expect(mainEnergy(tpl("tpl-ride-z2-40"))).toBe(2);
    const plan = sectionsPlan(openSections(2), origin, 0, false);
    expect(plan.blocks.length).toBe(90);
    expect(plan.blocks.every((b) => b.level === 2)).toBe(true);
  });

  test("the workout page shows the intensities a workout will use", () => {
    expect(templateSections(tpl("tpl-kettlebell-emom-20")).map((s) => s.level)).toEqual([1, 3]);
    expect(templateSections(tpl("tpl-varg-yoga-20")).map((s) => s.level)).toEqual([1]);
  });
});
