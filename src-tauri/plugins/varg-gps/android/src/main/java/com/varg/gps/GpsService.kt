package com.varg.gps

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Foreground location service for a run stage. Android freezes the WebView
 * when the screen locks, so JavaScript cannot watch the position itself;
 * this service keeps receiving fixes, feeds RunTracker, and buzzes and
 * beeps the moment the target distance is reached so the athlete knows the
 * stage is done without looking at the phone.
 */
class GpsService : Service() {
    companion object {
        const val EXTRA_TARGET = "targetMeters"
        const val EXTRA_START = "startMeters"
        private const val CHANNEL = "varg_run"
        private const val NOTIFICATION_ID = 4711
        /** Notification text refresh limit; every fix would be noise. */
        private const val NOTIFY_EVERY_MS = 5000L
    }

    private var locationManager: LocationManager? = null
    private var lastNotified = 0L

    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            val crossed = RunTracker.onFix(location)
            if (crossed) {
                signalCrossed()
                notifyProgress(force = true)
            } else {
                notifyProgress(force = false)
            }
        }

        // Pre-API-30 devices call these; the defaults are not present there.
        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {
            RunTracker.error = "Location was switched off on the phone."
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    @SuppressLint("MissingPermission") // GpsPlugin checks before starting us.
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val target = intent?.getDoubleExtra(EXTRA_TARGET, 0.0) ?: 0.0
        val start = intent?.getDoubleExtra(EXTRA_START, 0.0) ?: 0.0
        RunTracker.reset(target, start)
        ensureChannel()
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        } else {
            0
        }
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type)
        } catch (e: Exception) {
            // Never let run tracking take the app down; the stage shows why.
            RunTracker.error = "Could not start run tracking: ${e.message}"
            stopSelf()
            return START_NOT_STICKY
        }

        val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        locationManager = lm
        lm.removeUpdates(listener)
        try {
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, listener, Looper.getMainLooper())
        } catch (e: Exception) {
            RunTracker.error = "Could not start GPS: ${e.message}"
        }
        // Not sticky: if Android kills the process, the workout is gone too,
        // and a tracker restarting on its own would count a run nobody started.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        locationManager?.removeUpdates(listener)
        RunTracker.stop()
        super.onDestroy()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Run tracking", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shown while Varg measures a run with GPS"
                },
            )
        }
    }

    private fun buildNotification(): Notification {
        val km = RunTracker.meters / 1000.0
        val target = RunTracker.targetMeters / 1000.0
        val text = when {
            RunTracker.crossedAtMs != 0L -> String.format("%.2f km — distance reached, open Varg", km)
            target > 0 -> String.format("%.2f / %.2f km", km, target)
            else -> String.format("%.2f km", km)
        }
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Varg — measuring your run")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .build()
    }

    private fun notifyProgress(force: Boolean) {
        val now = System.currentTimeMillis()
        if (!force && now - lastNotified < NOTIFY_EVERY_MS) return
        lastNotified = now
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIFICATION_ID, buildNotification())
        } catch (_: SecurityException) {
            // Notifications denied on Android 13+: tracking carries on regardless.
        }
    }

    /** Distance reached: a buzz and a beep, audible with the phone in a pocket. */
    private fun signalCrossed() {
        try {
            val v = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 300, 150, 300, 150, 600), -1))
            } else {
                @Suppress("DEPRECATION")
                v.vibrate(longArrayOf(0, 300, 150, 300, 150, 600), -1)
            }
        } catch (_: Exception) {}
        try {
            val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 100)
            tone.startTone(ToneGenerator.TONE_PROP_ACK, 600)
            android.os.Handler(Looper.getMainLooper()).postDelayed({ tone.release() }, 800)
        } catch (_: Exception) {}
    }
}
