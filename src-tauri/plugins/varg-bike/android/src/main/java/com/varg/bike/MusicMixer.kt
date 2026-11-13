package com.varg.bike

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * Renders the ride's music score into PCM: plain Kotlin, no Android, so it
 * is unit-tested on the JVM (src/test). MusicEngine feeds it to an
 * AudioTrack in the ride service, on screen and off.
 *
 * The score is computed in the app (src/lib/score.ts, tested there) and
 * this only executes it: every voice's place in its song is a pure
 * function of the wall clock (start, offset, rate, the loop), its gain and
 * high-pass are point curves, so a new score that keeps a voice keeps it
 * exactly and can replace the old one at any moment without a seam.
 * After the voices: the cue duck, the mute and a limiter, as in the
 * browser mixer.
 */
class MusicMixer(val outRate: Int) {
    /** A song's buffer: its lead-up then its loop, 16-bit interleaved. */
    class Song(val sampleRate: Int, val channels: Int, val pcm: ShortArray) {
        val frames = pcm.size / channels
    }

    class Voice(
        val songId: String,
        val at: Double,
        val start: Double,
        val offset: Double,
        val stop: Double?,
        val rate: Double,
        val trim: Double,
        val loopStart: Double,
        val loopEnd: Double,
        val gain: DoubleArray, // t0, v0, t1, v1, ... (wall ms, gain)
        val hp: DoubleArray, // t0, hz0, ... (wall ms, Hz)
    ) {
        val key = "$songId@$at"

        fun positionAt(t: Double): Double {
            val p = offset + (t - start) / 1000.0 * rate
            if (p < loopEnd) return p
            val len = loopEnd - loopStart
            return loopStart + ((p - loopStart) % len)
        }
    }

    /** Per-voice high-pass state, kept across blocks and scores. */
    private class Filter {
        var x1 = DoubleArray(2); var x2 = DoubleArray(2)
        var y1 = DoubleArray(2); var y2 = DoubleArray(2)
    }

    @Volatile var songs: Map<String, Song> = emptyMap()
    @Volatile var score: List<Voice> = emptyList()
    private val filters = HashMap<String, Filter>()

    @Volatile var muted = false
    /** Wall ms until which the music is ducked under a cue. */
    @Volatile var duckUntil = 0.0
    /** How far down the duck goes: the ride's DUCK_LEVEL, or a guided workout's lighter one. */
    @Volatile var duckLevel = DUCK_LEVEL
    private var duckGain = 1.0
    private var master = 1.0
    private var env = 0.0

    companion object {
        const val DUCK_LEVEL = 0.22
        /** Limiter: threshold (linear), ratio, attack and release (s). */
        const val LIMIT = 0.5
        const val RATIO = 20.0
        const val ATTACK_S = 0.002
        const val RELEASE_S = 0.2

        /** Value of a point curve at t: held before the first and after the last. */
        fun valueAt(points: DoubleArray, t: Double): Double {
            if (points.isEmpty()) return 0.0
            if (t <= points[0]) return points[1]
            var i = 2
            while (i < points.size) {
                val t0 = points[i - 2]; val v0 = points[i - 1]
                val t1 = points[i]; val v1 = points[i + 1]
                if (t <= t1) return if (t1 == t0) v1 else v0 + (v1 - v0) * (t - t0) / (t1 - t0)
                i += 2
            }
            return points[points.size - 1]
        }
    }

    /**
     * Render `frames` stereo frames into `out` (interleaved 16-bit), the
     * first of them playing at wall time `t0` (ms).
     */
    fun render(out: ShortArray, frames: Int, t0: Double) {
        val mix = DoubleArray(frames * 2)
        val msPerFrame = 1000.0 / outRate
        val t1 = t0 + frames * msPerFrame
        val songs = this.songs
        val alive = HashSet<String>()
        for (v in score) {
            val song = songs[v.songId] ?: continue
            if (t1 <= v.start || (v.stop != null && t0 >= v.stop)) {
                if (v.stop == null || t0 < v.stop) alive.add(v.key)
                continue
            }
            alive.add(v.key)
            renderVoice(v, song, mix, frames, t0, msPerFrame)
        }
        // Filters of voices gone from the score go too.
        filters.keys.retainAll(alive)

        // Duck, mute and limiter, per frame, smoothed.
        val duckStep = 1.0 / (0.06 * outRate)
        val masterStep = 1.0 / (0.1 * outRate)
        val attack = 1.0 - Math.exp(-1.0 / (ATTACK_S * outRate))
        val release = 1.0 - Math.exp(-1.0 / (RELEASE_S * outRate))
        for (i in 0 until frames) {
            val t = t0 + i * msPerFrame
            val duckTarget = if (t < duckUntil) duckLevel else 1.0
            duckGain += (duckTarget - duckGain).coerceIn(-duckStep, duckStep * 0.25)
            val masterTarget = if (muted) 0.0 else 1.0
            master += (masterTarget - master).coerceIn(-masterStep, masterStep)
            val l = mix[2 * i] * duckGain * master
            val r = mix[2 * i + 1] * duckGain * master
            val peak = max(abs(l), abs(r))
            env += (peak - env) * (if (peak > env) attack else release)
            val g = if (env > LIMIT) (LIMIT + (env - LIMIT) / RATIO) / env else 1.0
            out[2 * i] = toShort(l * g)
            out[2 * i + 1] = toShort(r * g)
        }
    }

    private fun toShort(x: Double): Short = (x.coerceIn(-1.0, 1.0) * 32767.0).toInt().toShort()

    private fun renderVoice(v: Voice, song: Song, mix: DoubleArray, frames: Int, t0: Double, msPerFrame: Double) {
        val f = filters.getOrPut(v.key) { Filter() }
        // High-pass coefficients for this block (RBJ, Q 0.707), at its middle.
        val tMid = t0 + frames * msPerFrame / 2
        val fc = MusicMixer.valueAt(v.hp, tMid).coerceIn(5.0, outRate * 0.45)
        val w0 = 2 * PI * fc / outRate
        val alpha = sin(w0) / (2 * 0.7071)
        val cw = cos(w0)
        val a0 = 1 + alpha
        val b0 = (1 + cw) / 2 / a0; val b1 = -(1 + cw) / a0; val b2 = b0
        val a1 = -2 * cw / a0; val a2 = (1 - alpha) / a0

        val srcRate = song.sampleRate.toDouble()
        val loopStartF = v.loopStart * srcRate
        val loopEndF = min(v.loopEnd * srcRate, song.frames.toDouble() - 1)
        val loopLenF = loopEndF - loopStartF
        val step = v.rate * srcRate / outRate
        val ch = song.channels
        val pcm = song.pcm
        // Position at the block's first frame, from the clock, then stepped.
        var pos = v.positionAt(t0) * srcRate
        for (i in 0 until frames) {
            val t = t0 + i * msPerFrame
            if (t >= v.start && (v.stop == null || t < v.stop) && pos >= 0) {
                if (pos >= loopEndF) pos = loopStartF + ((pos - loopStartF) % loopLenF)
                val i0 = pos.toInt()
                val frac = pos - i0
                val i1 = min(i0 + 1, song.frames - 1)
                // Per frame: a fade must not start a block early (21 ms).
                val g = MusicMixer.valueAt(v.gain, t) * v.trim
                for (c in 0..1) {
                    val sc = if (ch == 1) 0 else c
                    val s0 = pcm[i0 * ch + sc] / 32768.0
                    val s1 = pcm[i1 * ch + sc] / 32768.0
                    val x = s0 + (s1 - s0) * frac
                    val y = b0 * x + b1 * f.x1[c] + b2 * f.x2[c] - a1 * f.y1[c] - a2 * f.y2[c]
                    f.x2[c] = f.x1[c]; f.x1[c] = x
                    f.y2[c] = f.y1[c]; f.y1[c] = y
                    mix[2 * i + c] += y * g
                }
            }
            pos += step
        }
    }
}
