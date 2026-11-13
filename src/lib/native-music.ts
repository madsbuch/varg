/**
 * The ride's music on the native player (MusicEngine.kt), with the browser
 * mixer's interface so the ride player can use either.
 *
 * In the Android app the music must not live in the WebView: off screen it
 * kept playing but stopped switching songs. Here the app still does all
 * the deciding (score.ts: which song when, its fades, filter and level,
 * tested) and the native side only renders it, so a ride sounds the same
 * on screen and off. Songs go over once per composed track; the score goes
 * over on every change.
 */
import { nativeMusicDuck, nativeMusicHas, nativeMusicMute, nativeMusicScore, nativeMusicSong, nativeMusicStop } from "./bike";
import type { SongLoop } from "./mixer";
import { scoreSong } from "./mixer";
import { scoreVoices } from "./score";
import type { Booking, ScoreSong, Voice } from "./score";

export class NativeMusic {
  private readonly songs = new Map<string, ScoreSong>();
  private score: Voice[] = [];
  private readonly onError: (message: string) => void;
  private stopped = false;

  constructor(onError: (message: string) => void) {
    this.onError = onError;
  }

  /** Make a song playable natively: sent unless this very track already is. */
  async add(song: SongLoop, trackKey: string): Promise<void> {
    const key = `${trackKey}|${song.loop.start.toFixed(4)}|${song.loop.bars}`;
    if (!(await nativeMusicHas(song.song.id, key))) await nativeMusicSong(song.song.id, key, song.buffer);
    this.songs.set(song.song.id, scoreSong(song));
  }

  has(songId: string): boolean {
    return this.songs.has(songId);
  }

  book(bookings: Booking[], paused: boolean, firstAt?: number): void {
    if (this.stopped) return;
    this.score = scoreVoices(this.score, bookings, this.songs, Date.now(), paused, firstAt);
    nativeMusicScore({ voices: this.score }).then(
      (err) => { if (err) this.onError(err); },
      (e: unknown) => { this.onError(e instanceof Error ? e.message : String(e)); },
    );
  }

  duck(hold: number, level?: number): void {
    void nativeMusicDuck(hold, level).catch(() => undefined);
  }

  setMuted(muted: boolean): void {
    void nativeMusicMute(muted).catch(() => undefined);
  }

  dispose(): void {
    this.stopped = true;
    void nativeMusicStop().catch(() => undefined);
  }
}
