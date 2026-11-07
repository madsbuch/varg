package com.varg.gps

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import androidx.core.content.ContextCompat
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class StartArgs {
    var targetMeters: Double = 0.0
    /** Distance already run in this stage, when it is resumed after an undo. */
    var startMeters: Double = 0.0
}

/**
 * Bridge between the for-time player and GpsService. Every refusal is a
 * rejected invoke with a reason the player shows — never a silent no-op,
 * because "GPS on" over a tracker that never started means a run that is
 * never auto-completed.
 */
@TauriPlugin(
    permissions = [
        Permission(
            strings = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION],
            alias = "location",
        ),
    ],
)
class GpsPlugin(private val activity: Activity) : Plugin(activity) {

    private fun locationEnabled(): Boolean {
        val lm = activity.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
    }

    @Command
    fun start(invoke: Invoke) {
        val args = invoke.parseArgs(StartArgs::class.java)
        if (getPermissionState("location") != PermissionState.GRANTED) {
            invoke.reject("Location permission is not granted — allow it in Settings → GPS.")
            return
        }
        if (!locationEnabled()) {
            invoke.reject("Location is switched off on the phone.")
            return
        }
        val intent = Intent(activity, GpsService::class.java)
            .putExtra(GpsService.EXTRA_TARGET, args.targetMeters)
            .putExtra(GpsService.EXTRA_START, args.startMeters)
        try {
            ContextCompat.startForegroundService(activity, intent)
        } catch (e: Exception) {
            invoke.reject("Could not start run tracking: ${e.message}")
            return
        }
        invoke.resolve(snapshot())
    }

    @Command
    fun stop(invoke: Invoke) {
        val last = snapshot()
        activity.stopService(Intent(activity, GpsService::class.java))
        RunTracker.stop()
        invoke.resolve(last)
    }

    @Command
    fun status(invoke: Invoke) {
        invoke.resolve(snapshot())
    }

    private fun snapshot(): JSObject {
        val o = JSObject()
        o.put("running", RunTracker.running)
        o.put("startedAtMs", RunTracker.startedAtMs)
        o.put("targetMeters", RunTracker.targetMeters)
        o.put("meters", RunTracker.meters)
        o.put("crossedAtMs", RunTracker.crossedAtMs)
        o.put("fixes", RunTracker.fixes)
        o.put("lastAccuracy", RunTracker.lastAccuracy.toDouble())
        o.put("lastFixAtMs", RunTracker.lastFixAtMs)
        o.put("locationEnabled", locationEnabled())
        RunTracker.error?.let { o.put("error", it) }
        return o
    }
}
