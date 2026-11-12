package com.varg.bike

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/**
 * The native music renderer against the score's rules (src/lib/score.ts):
 * a voice's place in its song is a pure function of the clock, loops wrap
 * into the loop, a new score with the same voice changes nothing, and the
 * gain, stop, duck and limiter do what the browser mixer does.
 */
class MusicMixerTest {
    private val sr = 48000

    /** 4 s of lead-up then a 2 s loop, silent but for a click at `clickAt` s. */
    private fun clickSong(clickAt: Double): MusicMixer.Song {
        val pcm = ShortArray(6 * sr)
        pcm[(clickAt * sr).toInt()] = (0.4 * 32767).toInt().toShort()
        return MusicMixer.Song(sr, 1, pcm)
    }

    private fun sineSong(amp: Double, hz: Double = 1000.0): MusicMixer.Song {
        val pcm = ShortArray(6 * sr) { (amp * 32767 * sin(2 * PI * hz * it / sr)).toInt().toShort() }
        return MusicMixer.Song(sr, 1, pcm)
    }

    private fun voice(
        id: String,
        start: Double,
        offset: Double,
        rate: Double = 1.0,
        stop: Double? = null,
        gain: DoubleArray = doubleArrayOf(0.0, 1.0),
    ) = MusicMixer.Voice(id, start, start, offset, stop, rate, 1.0, 4.0, 6.0, gain, doubleArrayOf(0.0, 5.0))

    private fun render(m: MusicMixer, t0: Double, frames: Int): ShortArray {
        val out = ShortArray(frames * 2)
        var done = 0
        while (done < frames) {
            val n = minOf(1024, frames - done)
            val block = ShortArray(n * 2)
            m.render(block, n, t0 + done * 1000.0 / sr)
            block.copyInto(out, done * 2)
            done += n
        }
        return out
    }

    private fun peakFrame(out: ShortArray): Int {
        var best = 0
        for (i in 0 until out.size / 2) if (abs(out[2 * i].toInt()) > abs(out[2 * best].toInt())) best = i
        return best
    }

    @Test fun barOneLandsWhereTheClockSays() {
        val m = MusicMixer(sr)
        m.songs = mapOf("s" to clickSong(4.0))
        // Starts half a second before bar 1 (the buffer at 4 s).
        m.score = listOf(voice("s", start = 1000.0, offset = 3.5))
        val out = render(m, 1000.0, (0.6 * sr).toInt())
        assertEquals(24000.0, peakFrame(out).toDouble(), 1.0)
    }

    @Test fun aStretchedSongReachesBarOneSooner() {
        val m = MusicMixer(sr)
        m.songs = mapOf("s" to clickSong(4.0))
        m.score = listOf(voice("s", start = 1000.0, offset = 3.5, rate = 1.25))
        val out = render(m, 1000.0, (0.6 * sr).toInt())
        assertEquals(19200.0, peakFrame(out).toDouble(), 1.0)
    }

    @Test fun theLoopWrapsIntoTheLoopNotTheLeadUp() {
        val m = MusicMixer(sr)
        m.songs = mapOf("s" to clickSong(4.0)) // the loop's first frame
        m.score = listOf(voice("s", start = 0.0, offset = 5.9)) // 0.1 s before the loop's end
        val out = render(m, 0.0, (0.3 * sr).toInt())
        assertEquals(4800.0, peakFrame(out).toDouble(), 1.0)
    }

    @Test fun anewScoreWithTheSameVoiceChangesNothing() {
        val a = MusicMixer(sr).apply { songs = mapOf("s" to sineSong(0.3)); score = listOf(voice("s", 0.0, 4.0)) }
        val whole = render(a, 0.0, 4096)
        val b = MusicMixer(sr).apply { songs = mapOf("s" to sineSong(0.3)); score = listOf(voice("s", 0.0, 4.0)) }
        val first = render(b, 0.0, 2048)
        b.score = listOf(voice("s", 0.0, 4.0)) // recomputed: new objects, same voice
        val second = render(b, 2048 * 1000.0 / sr, 2048)
        assertArrayEquals(whole, first + second)
    }

    @Test fun silentBeforeItsStartAndAfterItsStop() {
        val m = MusicMixer(sr)
        m.songs = mapOf("s" to sineSong(0.3))
        m.score = listOf(voice("s", start = 100.0, offset = 4.0, stop = 200.0))
        val out = render(m, 0.0, (0.3 * sr).toInt())
        for (i in 0 until (0.1 * sr).toInt() - 1) assertEquals(0, out[2 * i].toInt())
        for (i in (0.2 * sr).toInt() + 1 until out.size / 2) assertEquals(0, out[2 * i].toInt())
        assertTrue((0.1 * sr).toInt() + 100 < out.size / 2 && out.slice((2 * (0.15 * sr).toInt()) until (2 * (0.16 * sr).toInt())).any { it.toInt() != 0 })
    }

    @Test fun theGainCurveIsFollowed() {
        val m = MusicMixer(sr)
        m.songs = mapOf("s" to sineSong(0.3))
        // Silent, then full from 500 ms.
        m.score = listOf(voice("s", 0.0, 4.0, gain = doubleArrayOf(0.0, 0.0, 400.0, 0.0, 500.0, 1.0)))
        val out = render(m, 0.0, (0.7 * sr).toInt())
        val peak = { a: Double, b: Double -> (2 * (a * sr).toInt() until 2 * (b * sr).toInt() step 2).maxOf { abs(out[it].toInt()) } }
        assertTrue(peak(0.1, 0.39) == 0)
        assertTrue(peak(0.55, 0.69) > 0.28 * 32767)
    }

    @Test fun theDuckStepsTheMusicBack() {
        val m = MusicMixer(sr)
        m.songs = mapOf("s" to sineSong(0.3))
        m.score = listOf(voice("s", 0.0, 4.0))
        m.duckUntil = 1000.0
        val out = render(m, 0.0, (0.5 * sr).toInt())
        val peak = (2 * (0.3 * sr).toInt() until out.size step 2).maxOf { abs(out[it].toInt()) }
        assertEquals(0.3 * MusicMixer.DUCK_LEVEL, peak / 32767.0, 0.01)
    }

    @Test fun twoLoudSongsAtOnceDoNotClip() {
        val m = MusicMixer(sr)
        m.songs = mapOf("a" to sineSong(0.9, 1000.0), "b" to sineSong(0.9, 1000.0))
        m.score = listOf(voice("a", 0.0, 4.0), voice("b", 0.0, 4.0))
        val out = render(m, 0.0, (0.5 * sr).toInt())
        // After the limiter's attack: held near its threshold, far from full scale.
        val peak = (2 * (0.05 * sr).toInt() until out.size step 2).maxOf { abs(out[it].toInt()) }
        assertTrue("peak ${peak / 32767.0}", peak < 0.65 * 32767)
    }
}

/**
 * The app's own score (src/lib/score.ts, written to score-fixture.json by
 * scripts/score-fixture.ts and kept current by scripts/score.test.ts),
 * parsed as the engine parses it and rendered: the crossfade lands as the
 * app means it to.
 */
class ScoreFixtureTest {
    private val sr = 48000

    /** 4 s of lead-up then a 2 s loop, silent but for a click on bar 1. */
    private fun clickSong(amp: Double): MusicMixer.Song {
        val pcm = ShortArray(6 * sr)
        pcm[4 * sr] = (amp * 32767).toInt().toShort()
        return MusicMixer.Song(sr, 1, pcm)
    }

    private fun render(m: MusicMixer, from: Double, to: Double): ShortArray {
        val frames = ((to - from) / 1000 * sr).toInt()
        val out = ShortArray(frames * 2)
        var done = 0
        while (done < frames) {
            val n = minOf(1024, frames - done)
            val block = ShortArray(n * 2)
            m.render(block, n, from + done * 1000.0 / sr)
            block.copyInto(out, done * 2)
            done += n
        }
        return out
    }

    private fun peakIn(out: ShortArray, from: Double, a: Double, b: Double): Pair<Double, Int> {
        var best = -1; var bestV = -1
        val i0 = ((a - from) / 1000 * sr).toInt(); val i1 = ((b - from) / 1000 * sr).toInt()
        for (i in i0 until i1) { val v = abs(out[2 * i].toInt()); if (v > bestV) { bestV = v; best = i } }
        return Pair(from + best * 1000.0 / sr, bestV)
    }

    @Test fun theAppsScoreLandsBarOneOnTheChange() {
        val json = javaClass.classLoader!!.getResource("score-fixture.json")!!.readText()
        val m = MusicMixer(sr)
        m.songs = mapOf("L" to clickSong(0.3), "M" to clickSong(0.3), "P" to clickSong(0.3))
        m.score = MusicEngine.parse(json)
        assertEquals(3, m.score.size)
        val from = 25_000.0
        val out = render(m, from, 33_000.0)
        // Mid's bar 1 on its block's first beat (ride 20 s = wall 30 s).
        val (t, amp) = peakIn(out, from, 29_900.0, 30_100.0)
        assertEquals(30_000.0, t, 1000.0 / sr)
        assertTrue(amp > 0.1 * 32767)
        // Its loop comes round 2 s later, stretched by its rate (1.02).
        assertEquals(30_000.0 + 2000.0 / 1.02, peakIn(out, from, 31_500.0, 32_500.0).first, 1000.0 / sr)
        // Low is gone after the change: nothing where its next bar 1 would be.
        assertTrue(peakIn(out, from, 31_990.0, 32_010.0).second < 0.01 * 32767)
    }
}
