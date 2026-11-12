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
