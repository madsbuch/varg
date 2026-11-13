package com.varg.bike

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTimestamp
import android.media.AudioTrack
import org.json.JSONArray
import org.json.JSONObject
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/**
 * The ride's music, played natively: MusicMixer rendering the app's score
 * into an AudioTrack on its own thread. One player for the whole ride, on
 * screen and off: the WebView's audio stops switching songs off screen,
 * this does not. The ride service (a foreground service) keeps the
 * process alive; the music needs nothing from the WebView once the score
 * is in, because every song change is in it ahead of time.
 *
 * The output clock is tied to the wall clock through the track's own
 * timestamps, so bar 1 lands on the block change the ride player counts.
 *
 * Songs arrive once per composed track (16-bit PCM of the lead-up and
 * loop the app cut), are kept in the app's cache dir and reloaded from
 * there on later rides: `has` before `put`.
 */
object MusicEngine {
    private val songs = ConcurrentHashMap<String, MusicMixer.Song>()
    private var mixer: MusicMixer? = null
    private var thread: Thread? = null
    @Volatile private var running = false
    @Volatile var error: String? = null; private set

    private fun dir(ctx: Context) = File(ctx.cacheDir, "varg-songs").apply { mkdirs() }

    private fun file(ctx: Context, id: String, key: String): File {
        val name = MessageDigest.getInstance("SHA-1").digest("$id|$key".toByteArray())
            .joinToString("") { String.format("%02x", it) }
        return File(dir(ctx), "$name.pcm")
    }

    /** Is this song (this composed track) ready? Loads it from the cache if need be. */
    fun has(ctx: Context, id: String, key: String): Boolean {
        val f = file(ctx, id, key)
        if (songs["$id|$key"] != null) {
            use(id, key)
            return true
        }
        if (!f.exists()) return false
        return try {
            DataInputStream(f.inputStream().buffered()).use { inp ->
                val rate = inp.readInt()
                val ch = inp.readInt()
                val n = inp.readInt()
                val bytes = ByteArray(n * 2)
                inp.readFully(bytes)
                val pcm = ShortArray(n)
                ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(pcm)
                songs["$id|$key"] = MusicMixer.Song(rate, ch, pcm)
            }
            use(id, key)
            true
        } catch (_: Exception) {
            f.delete()
            false
        }
    }

    /** Take a song's PCM (little-endian 16-bit, interleaved) and keep it. */
    fun put(ctx: Context, id: String, key: String, sampleRate: Int, channels: Int, bytes: ByteArray) {
        val pcm = ShortArray(bytes.size / 2)
        ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(pcm)
        songs["$id|$key"] = MusicMixer.Song(sampleRate, channels, pcm)
        try {
            DataOutputStream(file(ctx, id, key).outputStream().buffered()).use { out ->
                out.writeInt(sampleRate)
                out.writeInt(channels)
                out.writeInt(pcm.size)
                out.write(bytes)
            }
        } catch (_: Exception) {
            // No cache: it is sent again next ride.
        }
        use(id, key)
    }

    /** The mixer plays songs by id: point an id at this track. */
    private fun use(id: String, key: String) {
        val s = songs["$id|$key"] ?: return
        val m = mixer
        val map = HashMap(m?.songs ?: emptyMap())
        map[id] = s
        pending[id] = s
        if (m != null) m.songs = map
    }

    private val pending = ConcurrentHashMap<String, MusicMixer.Song>()

    /** Replace the score (JSON from src/lib/score.ts) and make sure we play. */
    fun score(json: String) {
        val voices = parse(json)
        ensureRunning()
        mixer?.score = voices
    }

    fun duck(holdS: Double, level: Double = MusicMixer.DUCK_LEVEL) {
        val m = mixer ?: return
        m.duckLevel = level
        m.duckUntil = System.currentTimeMillis() + holdS * 1000
    }

    fun mute(muted: Boolean) {
        mixer?.muted = muted
    }

    fun stop() {
        running = false
        thread?.join(500)
        thread = null
        mixer = null
    }

    /** The score JSON (src/lib/score.ts) as voices; internal for the fixture test. */
    internal fun parse(json: String): List<MusicMixer.Voice> {
        val arr = JSONObject(json).optJSONArray("voices") ?: JSONArray()
        val out = ArrayList<MusicMixer.Voice>(arr.length())
        fun points(a: JSONArray?): DoubleArray {
            if (a == null) return DoubleArray(0)
            val d = DoubleArray(a.length() * 2)
            for (i in 0 until a.length()) {
                val p = a.getJSONArray(i)
                d[2 * i] = p.getDouble(0)
                d[2 * i + 1] = p.getDouble(1)
            }
            return d
        }
        for (i in 0 until arr.length()) {
            val v = arr.getJSONObject(i)
            out.add(
                MusicMixer.Voice(
                    songId = v.getString("songId"),
                    at = v.getDouble("at"),
                    start = v.getDouble("start"),
                    offset = v.getDouble("offset"),
                    stop = if (v.isNull("stop")) null else v.getDouble("stop"),
                    rate = v.getDouble("rate"),
                    trim = v.getDouble("trim"),
                    loopStart = v.getDouble("loopStart"),
                    loopEnd = v.getDouble("loopEnd"),
                    gain = points(v.optJSONArray("gain")),
                    hp = points(v.optJSONArray("hp")),
                ),
            )
        }
        return out
    }

    private fun ensureRunning() {
        if (running && thread?.isAlive == true) return
        error = null
        val rate = AudioTrack.getNativeOutputSampleRate(AudioManager.STREAM_MUSIC).takeIf { it > 0 } ?: 48000
        val m = MusicMixer(rate)
        m.songs = HashMap(pending)
        mixer = m
        running = true
        thread = Thread({ loop(m, rate) }, "varg-music").apply { start() }
    }

    private fun loop(m: MusicMixer, rate: Int) {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO)
        val block = 1024
        val minBuf = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT)
        val bufBytes = maxOf(minBuf, rate / 10 * 4) // at least 100 ms
        val track = try {
            AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build(),
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(rate)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                        .build(),
                )
                .setBufferSizeInBytes(bufBytes)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
        } catch (e: Exception) {
            error = "Music output failed: ${e.message}"
            running = false
            return
        }
        val out = ShortArray(block * 2)
        val ts = AudioTimestamp()
        // Wall time of frame 0: until the track reports a timestamp, now
        // plus the buffer it holds before playing.
        var anchor = System.currentTimeMillis() + bufBytes / 4 * 1000.0 / rate
        var written = 0L
        var lastSync = 0L
        try {
            track.play()
            while (running) {
                m.render(out, block, anchor + written * 1000.0 / rate)
                var off = 0
                while (off < out.size && running) {
                    val n = track.write(out, off, out.size - off)
                    if (n < 0) throw IllegalStateException("AudioTrack write $n")
                    off += n
                }
                written += block
                // Keep the output clock on the wall clock: the frame the
                // track is playing now, and when.
                val nowNs = System.nanoTime()
                if (nowNs - lastSync > 1_000_000_000L && track.getTimestamp(ts)) {
                    lastSync = nowNs
                    val wallAtTs = System.currentTimeMillis() - (nowNs - ts.nanoTime) / 1e6
                    val measured = wallAtTs - ts.framePosition * 1000.0 / rate
                    val drift = measured - anchor
                    // A jump for a big error (the first sync), a nudge for drift.
                    anchor += if (kotlin.math.abs(drift) > 20) drift else drift * 0.1
                }
            }
        } catch (e: Exception) {
            error = "Music output stopped: ${e.message}"
        } finally {
            try { track.stop() } catch (_: Exception) {}
            track.release()
            running = false
        }
    }
}
