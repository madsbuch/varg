/**
 * Spoken cues for flows: the guided player says each pose as it begins
 * ("Warrior two, left side"), so a yoga session can be followed without
 * looking at the phone.
 *
 * In the Android app this is the phone's TextToSpeech engine, through the
 * in-repo varg-voice plugin — the WebView has no speech synthesis of its
 * own. In a browser it is the Web Speech API. Failures come back as
 * reasons the player shows; a voice that silently says nothing would leave
 * the athlete waiting for a cue that never comes.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../db/persistence";
import { duckMusic } from "./beep";
import type { Side } from "../types";

const SETTING_KEY = "varg.voice.v1";

export function loadVoiceOn(): boolean {
  try {
    return localStorage.getItem(SETTING_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveVoiceOn(on: boolean): void {
  try {
    localStorage.setItem(SETTING_KEY, on ? "1" : "0");
  } catch {
    // remembered for this session only
  }
}

/** How a pose name should sound: "Warrior II" is "Warrior two", not "Warrior eye eye". */
export function spokenName(name: string): string {
  return name
    .replace(/\bII\b/g, "two")
    .replace(/\bI\b/g, "one")
    .replace(/'/g, "");
}

export function poseLine(name: string, side: Side | undefined, prefix = ""): string {
  const sided = side ? `, ${side} side` : "";
  return `${prefix}${spokenName(name)}${sided}`;
}

/** Rough speaking time, so the music ducks for the whole line. */
function speakingSeconds(text: string): number {
  return Math.min(4, 0.6 + text.split(/\s+/).length * 0.38);
}

/** Speak a line now, interrupting any line still being spoken. */
export async function speak(text: string): Promise<void> {
  duckMusic(speakingSeconds(text));
  if (isTauri() && /Android/i.test(navigator.userAgent)) {
    try {
      await invoke("plugin:varg-voice|speak", { text });
      return;
    } catch (e) {
      throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
    }
  }
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    throw new Error("This device has no speech voice.");
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-GB";
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}
