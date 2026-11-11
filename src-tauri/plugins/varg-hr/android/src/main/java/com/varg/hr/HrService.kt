package com.varg.hr

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Keeps the heart-rate strap recording while a workout runs and Varg is
 * not on screen — the phone locked in a pocket, or on the floor between
 * sets. As a foreground service it keeps the process (and HrLink's
 * Bluetooth connection and packet queue) alive; the frontend replays the
 * queue when it wakes. The notification says whether the strap is
 * delivering, so a dropout is visible without opening the app.
 */
class HrService : Service() {
    companion object {
        const val ACTION_START = "com.varg.hr.START"
        const val ACTION_STOP = "com.varg.hr.STOP"
        private const val CHANNEL = "varg_hr"
        private const val NOTIFICATION_ID = 4713

        @Volatile var title: String = "Workout"
        @Volatile var running = false; private set
        /** Why the last start failed, for the plugin to report. */
        @Volatile var startError: String? = null
    }

    private val main = Handler(Looper.getMainLooper())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopEverything()
            return START_NOT_STICKY
        }
        ensureChannel()
        val type = if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(statusLine()), type)
        } catch (e: Exception) {
            // Behind the plugin's permission check: a service that cannot
            // start must not take the app down with it.
            startError = "Can't record heart rate in the background: ${e.message}"
            stopSelf()
            return START_NOT_STICKY
        }
        startError = null
        running = true
        main.removeCallbacksAndMessages(null)
        main.post(refresher)
        // Not sticky: if Android kills the process the workout is gone with
        // the WebView, and a service restarting on its own records nothing.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopEverything()
        super.onDestroy()
    }

    private fun stopEverything() {
        running = false
        main.removeCallbacksAndMessages(null)
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private val refresher = object : Runnable {
        override fun run() {
            if (!running) return
            try {
                val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                nm.notify(NOTIFICATION_ID, notification(statusLine()))
            } catch (_: SecurityException) {
                // notifications denied: the recording carries on regardless
            }
            main.postDelayed(this, 5000)
        }
    }

    private fun statusLine(): String {
        val now = System.currentTimeMillis()
        return when {
            HrLink.state == "reconnecting" -> "Heart rate lost — reconnecting to ${HrLink.deviceName}"
            HrLink.state != "connected" -> "Heart-rate strap not connected"
            now - HrLink.lastPacketAt > 5000 -> "No heart rate from ${HrLink.deviceName} — check the strap"
            else -> "Recording heart rate from ${HrLink.deviceName}"
        }
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Heart rate", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shown while a Varg workout records your heart rate in the background"
                },
            )
        }
    }

    private fun notification(text: String): Notification {
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Varg — $title")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .build()
    }
}
