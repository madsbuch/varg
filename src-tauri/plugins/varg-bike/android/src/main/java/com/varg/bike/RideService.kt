package com.varg.bike

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.ToneGenerator
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.tts.TextToSpeech
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import org.json.JSONObject
import java.io.File
import java.util.Locale

/**
 * Keeps a ride alive while Varg is in the background — the user watching a
 * video through a long zone-2 ride. As a foreground service it keeps the
 * process (and BikeLink's Bluetooth connection and packet recording) alive,
 * shows the ride in a notification, and plays the ride's cues on schedule.
 *
 * The frontend owns the ride and sends the schedule: every cue's wall-clock
 * time and line, recomputed on every change (block, pause, resume). Cues
 * play only while Varg is NOT on screen — on screen, the app speaks them
 * itself — so each one sounds exactly once.
 */
class RideService : Service() {
    companion object {
        const val ACTION_START = "com.varg.bike.START"
        const val ACTION_SCHEDULE = "com.varg.bike.SCHEDULE"
        const val ACTION_STOP = "com.varg.bike.STOP"
        private const val CHANNEL = "varg_ride"
        private const val NOTIFICATION_ID = 4712

        /** Latest schedule JSON from the frontend; read on ACTION_SCHEDULE. */
        @Volatile var schedule: String = "{}"
        @Volatile var title: String = "Ride"
        /** Spoken line → cached audio file (the generated voice clips). */
        val clips = java.util.concurrent.ConcurrentHashMap<String, File>()
        @Volatile var running = false; private set
        /** Why the last start failed, for the plugin to report. */
        @Volatile var startError: String? = null
    }

    private val main = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var player: MediaPlayer? = null
    private var segments = listOf<Pair<String, Long>>() // label, end ms (0 = kcal block)
    private var paused = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopEverything()
                return START_NOT_STICKY
            }
            ACTION_SCHEDULE -> if (running) applySchedule()
            else -> {
                ensureChannel()
                val type = if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0
                try {
                    ServiceCompat.startForeground(this, NOTIFICATION_ID, notification("Starting…"), type)
                } catch (e: Exception) {
                    // Belt and braces behind the plugin's permission check: a
                    // ride that cannot run in the background must not take
                    // the app down with it.
                    startError = "Can't run in the background: ${e.message}"
                    stopSelf()
                    return START_NOT_STICKY
                }
                running = true
                if (tts == null) {
                    tts = TextToSpeech(applicationContext) { status ->
                        ttsReady = status == TextToSpeech.SUCCESS && (tts?.setLanguage(Locale.UK) ?: -1) >= 0
                    }
                }
                applySchedule() // also (re)starts the notification refresher
            }
        }
        // Not sticky: if Android kills the process the ride is gone with the
        // WebView, and a service restarting on its own would ride nothing.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopEverything()
        super.onDestroy()
    }

    private fun stopEverything() {
        running = false
        MusicEngine.stop()
        main.removeCallbacksAndMessages(null)
        player?.release()
        player = null
        tts?.shutdown()
        tts = null
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    /** Replace every pending cue with the frontend's latest schedule. */
    private fun applySchedule() {
        main.removeCallbacksAndMessages(null)
        main.post(refresher)
        val json = try { JSONObject(schedule) } catch (_: Exception) { JSONObject() }
        paused = json.optBoolean("paused", false)
        val segs = json.optJSONArray("segments")
        segments = (0 until (segs?.length() ?: 0)).map {
            val o = segs!!.getJSONObject(it)
            o.optString("label") to o.optLong("endAt", 0L)
        }
        val cues = json.optJSONArray("cues") ?: return
        val now = System.currentTimeMillis()
        for (i in 0 until cues.length()) {
            val c = cues.getJSONObject(i)
            val at = c.optLong("at")
            if (at < now - 1000) continue
            val text = c.optString("text", "")
            val beep = c.optString("beep", "")
            main.postDelayed({ fire(text, beep) }, (at - now).coerceAtLeast(0))
        }
    }

    private fun fire(text: String, beep: String) {
        if (BikeLink.appVisible) return // the app speaks for itself on screen
        // The music steps back under the cue, as it does in the app.
        if (beep.isNotEmpty()) {
            MusicEngine.duck(if (beep == "tick") 0.25 else 0.6)
            tone(beep)
        }
        if (text.isNotEmpty()) {
            MusicEngine.duck(text.split(" ").size * 0.4 + 0.8)
            say(text)
        }
    }

    private fun tone(kind: String) {
        try {
            val g = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 90)
            when (kind) {
                "finish" -> g.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 500)
                "tick" -> g.startTone(ToneGenerator.TONE_PROP_BEEP, 120) // 3-2-1
                else -> g.startTone(ToneGenerator.TONE_PROP_BEEP2, 500)
            }
            main.postDelayed({ g.release() }, 700)
        } catch (_: Exception) {}
    }

    /** The generated clip when there is one, the phone's voice otherwise. */
    private fun say(text: String) {
        val file = clips[text]
        if (file != null && file.exists()) {
            try {
                player?.release()
                player = MediaPlayer().apply {
                    setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build(),
                    )
                    setDataSource(file.absolutePath)
                    setOnCompletionListener { it.release(); if (player == it) player = null }
                    prepare()
                    start()
                }
                return
            } catch (_: Exception) {
                // fall through to the phone's voice
            }
        }
        if (ttsReady) tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "varg-ride")
    }

    private val refresher = object : Runnable {
        override fun run() {
            if (!running) return
            try {
                val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                nm.notify(NOTIFICATION_ID, notification(statusLine()))
            } catch (_: SecurityException) {
                // notifications denied: the ride carries on regardless
            }
            main.postDelayed(this, 5000)
        }
    }

    private fun statusLine(): String {
        val now = System.currentTimeMillis()
        if (paused) return "Paused — open Varg to resume"
        val bike = if (BikeLink.state != "connected") " · bike not connected" else if (now - BikeLink.lastPacketAt > 5000) " · no bike data" else ""
        val seg = segments.firstOrNull { it.second == 0L || it.second > now } ?: return "Ride complete — open Varg$bike"
        if (seg.second == 0L) return "${seg.first} · kcal block — open Varg for the count$bike"
        val left = ((seg.second - now) / 1000).coerceAtLeast(0)
        return String.format("%s · %d:%02d left%s", seg.first, left / 60, left % 60, bike)
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Ride in progress", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shown while a Varg ride keeps running in the background"
                },
            )
        }
    }

    private fun notification(text: String): Notification {
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("Varg — $title")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .build()
    }
}
