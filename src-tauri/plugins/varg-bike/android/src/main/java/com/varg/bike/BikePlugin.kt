package com.varg.bike

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Base64
import android.app.Application
import android.os.Bundle
import android.webkit.WebView
import androidx.core.content.ContextCompat
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.security.MessageDigest

@InvokeArg
class ScanArgs {
    var seconds: Int = 6
}

@InvokeArg
class ConnectArgs {
    var address: String = ""
}

@InvokeArg
class StartRideArgs {
    var title: String = "Ride"
    var schedule: String = "{}"
}

@InvokeArg
class ScheduleArgs {
    var schedule: String = "{}"
}

@InvokeArg
class SongArgs {
    var id: String = ""
    var key: String = ""
    var sampleRate: Int = 48000
    var channels: Int = 2
    var b64: String = ""
}

@InvokeArg
class ScoreArgs {
    var score: String = "{}"
}

@InvokeArg
class DuckArgs {
    var hold: Double = 1.0
}

@InvokeArg
class MuteArgs {
    var muted: Boolean = false
}

@InvokeArg
class CueAudioArgs {
    var text: String = ""
    var b64: String = ""
    var ext: String = "mp3"
}

/**
 * Bluetooth LE link to an indoor bike, plus the ride's background service.
 * Scans for the two standard services bikes use — Fitness Machine (FTMS)
 * and Cycling Power — and hands the connection to BikeLink, which records
 * raw packets for the frontend to parse. Every failure is a rejected
 * invoke or an `error` in the state the ride player shows.
 */
@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT], alias = "bluetooth"),
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION], alias = "location"),
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
    ],
)
class BikePlugin(private val activity: Activity) : Plugin(activity) {
    private val main = Handler(Looper.getMainLooper())
    private val found = LinkedHashMap<String, JSObject>()
    // Varg on screen or not, from Android itself: the service speaks the
    // cues only while it is off screen. Tauri's plugin onPause/onResume
    // were not delivered reliably, and the coach went silent off screen.
    private val visibility = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityResumed(a: Activity) { if (a === activity) BikeLink.appVisible = true }
        override fun onActivityPaused(a: Activity) { if (a === activity) BikeLink.appVisible = false }
        override fun onActivityCreated(a: Activity, b: Bundle?) {}
        override fun onActivityStarted(a: Activity) {}
        override fun onActivityStopped(a: Activity) {}
        override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
        override fun onActivityDestroyed(a: Activity) {}
    }

    override fun load(webView: WebView) {
        super.load(webView)
        activity.application.registerActivityLifecycleCallbacks(visibility)
    }

    override fun onResume() {
        super.onResume()
        BikeLink.appVisible = true
    }

    override fun onPause() {
        super.onPause()
        BikeLink.appVisible = false
    }

    private fun adapter(): BluetoothAdapter? =
        (activity.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?)?.adapter

    /** The runtime permission this Android version needs for BLE. */
    private fun neededAlias() = if (Build.VERSION.SDK_INT >= 31) "bluetooth" else "location"

    private fun granted() = getPermissionState(neededAlias()) == PermissionState.GRANTED

    @Command
    fun ensurePermissions(invoke: Invoke) {
        if (granted()) {
            invoke.resolve(JSObject().put("granted", true))
            return
        }
        // Android 13+: also the notification, so a ride in the background
        // shows its block and time left. Riding works without it.
        val aliases = if (Build.VERSION.SDK_INT >= 33) arrayOf(neededAlias(), "notifications") else arrayOf(neededAlias())
        requestPermissionForAliases(aliases, invoke, "permissionsDone")
    }

    @PermissionCallback
    private fun permissionsDone(invoke: Invoke) {
        invoke.resolve(JSObject().put("granted", granted()))
    }

    private fun refuse(invoke: Invoke): Boolean {
        val a = adapter()
        when {
            a == null -> invoke.reject("This phone has no Bluetooth.")
            !a.isEnabled -> invoke.reject("Bluetooth is switched off.")
            !granted() -> invoke.reject("Bluetooth permission is not granted.")
            else -> return false
        }
        return true
    }

    @SuppressLint("MissingPermission") // refuse() checks it
    @Command
    fun scan(invoke: Invoke) {
        if (refuse(invoke)) return
        val args = invoke.parseArgs(ScanArgs::class.java)
        val scanner = adapter()?.bluetoothLeScanner
        if (scanner == null) {
            invoke.reject("Bluetooth scanning is unavailable.")
            return
        }
        synchronized(found) { found.clear() }
        var scanError: String? = null
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val services = result.scanRecord?.serviceUuids?.map { it.uuid } ?: emptyList()
                val kind = when {
                    services.contains(FTMS) -> "ftms"
                    services.contains(CYCLING_POWER) -> "cps"
                    else -> return
                }
                val o = JSObject()
                o.put("address", result.device.address)
                o.put("name", result.scanRecord?.deviceName ?: result.device.name ?: "Unnamed bike")
                o.put("rssi", result.rssi)
                o.put("protocol", kind)
                synchronized(found) { found[result.device.address] = o }
            }

            override fun onScanFailed(errorCode: Int) {
                scanError = "Bluetooth scan failed (code $errorCode)."
            }
        }
        val filters = listOf(
            ScanFilter.Builder().setServiceUuid(ParcelUuid(FTMS)).build(),
            ScanFilter.Builder().setServiceUuid(ParcelUuid(CYCLING_POWER)).build(),
        )
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        scanner.startScan(filters, settings, callback)
        main.postDelayed({
            try {
                scanner.stopScan(callback)
            } catch (_: Exception) {}
            val list = JSArray()
            synchronized(found) { found.values.forEach { list.put(it) } }
            val o = JSObject()
            o.put("devices", list)
            scanError?.let { o.put("error", it) }
            invoke.resolve(o)
        }, args.seconds.coerceIn(2, 20) * 1000L)
    }

    @Command
    fun connect(invoke: Invoke) {
        if (refuse(invoke)) return
        val args = invoke.parseArgs(ConnectArgs::class.java)
        val device = try {
            adapter()!!.getRemoteDevice(args.address)
        } catch (e: Exception) {
            invoke.reject("Unknown bike address ${args.address}.")
            return
        }
        BikeLink.connect(activity, device)
        invoke.resolve(snapshot(false))
    }

    @Command
    fun disconnect(invoke: Invoke) {
        BikeLink.disconnect()
        invoke.resolve(snapshot(false))
    }

    /** State plus every packet since the last read — all of them, however long Varg was away. */
    @Command
    fun read(invoke: Invoke) {
        invoke.resolve(snapshot(true))
    }

    private fun snapshot(drain: Boolean): JSObject {
        val o = JSObject()
        o.put("state", BikeLink.state)
        o.put("protocol", BikeLink.protocol)
        o.put("name", BikeLink.deviceName)
        o.put("background", RideService.running)
        RideService.startError?.let { o.put("serviceError", it) }
        BikeLink.error?.let { o.put("error", it) }
        val list = JSArray()
        if (drain) {
            for (p in BikeLink.drain()) {
                val j = JSObject()
                j.put("c", p.c)
                j.put("hex", p.hex)
                j.put("t", p.t)
                list.put(j)
            }
        }
        o.put("packets", list)
        return o
    }

    /** Start the background service for a ride: notification, recording, cues. */
    @Command
    fun startRide(invoke: Invoke) {
        val args = invoke.parseArgs(StartRideArgs::class.java)
        // Android 14+ kills the whole app if a connected-device foreground
        // service starts without Bluetooth permission. Check first, refuse
        // with a reason — never start a service that cannot start.
        if (Build.VERSION.SDK_INT >= 31 &&
            ContextCompat.checkSelfPermission(activity, Manifest.permission.BLUETOOTH_CONNECT) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            invoke.reject("Bluetooth permission is not granted — pair your bike in Settings → Cycling.")
            return
        }
        RideService.title = args.title
        RideService.schedule = args.schedule
        try {
            ContextCompat.startForegroundService(
                activity,
                Intent(activity, RideService::class.java).setAction(RideService.ACTION_START),
            )
        } catch (e: Exception) {
            invoke.reject("Could not keep the ride running in the background: ${e.message}")
            return
        }
        invoke.resolve()
    }

    @Command
    fun schedule(invoke: Invoke) {
        RideService.schedule = invoke.parseArgs(ScheduleArgs::class.java).schedule
        if (RideService.running) {
            activity.startService(Intent(activity, RideService::class.java).setAction(RideService.ACTION_SCHEDULE))
        }
        invoke.resolve()
    }

    /** A generated voice clip for the service to play while Varg is off screen. */
    @Command
    fun cueAudio(invoke: Invoke) {
        val args = invoke.parseArgs(CueAudioArgs::class.java)
        try {
            val dir = File(activity.cacheDir, "varg-cues").apply { mkdirs() }
            val name = MessageDigest.getInstance("SHA-1").digest(args.text.toByteArray())
                .joinToString("") { String.format("%02x", it) }
            val ext = if (args.ext.matches(Regex("[a-z0-9]{1,5}"))) args.ext else "bin"
            val file = File(dir, "$name.$ext")
            file.writeBytes(Base64.decode(args.b64, Base64.DEFAULT))
            RideService.clips[args.text] = file
        } catch (e: Exception) {
            invoke.reject("Could not store a voice clip: ${e.message}")
            return
        }
        invoke.resolve()
    }

    @Command
    fun stopRide(invoke: Invoke) {
        if (RideService.running) {
            activity.startService(Intent(activity, RideService::class.java).setAction(RideService.ACTION_STOP))
        }
        MusicEngine.stop()
        invoke.resolve()
    }

    /** Is this song's track already here (from an earlier ride)? */
    @Command
    fun musicHas(invoke: Invoke) {
        val a = invoke.parseArgs(SongArgs::class.java)
        val o = JSObject()
        o.put("has", MusicEngine.has(activity, a.id, a.key))
        invoke.resolve(o)
    }

    /** A song's cut audio (lead-up and loop), 16-bit PCM, for the native player. */
    @Command
    fun musicSong(invoke: Invoke) {
        val a = invoke.parseArgs(SongArgs::class.java)
        try {
            MusicEngine.put(activity, a.id, a.key, a.sampleRate, a.channels, Base64.decode(a.b64, Base64.DEFAULT))
        } catch (e: Exception) {
            invoke.reject("Could not take a song: ${e.message}")
            return
        }
        invoke.resolve()
    }

    /** The ride's music score (src/lib/score.ts); starts the player. */
    @Command
    fun musicScore(invoke: Invoke) {
        try {
            MusicEngine.score(invoke.parseArgs(ScoreArgs::class.java).score)
        } catch (e: Exception) {
            invoke.reject("Music score refused: ${e.message}")
            return
        }
        val o = JSObject()
        o.put("error", MusicEngine.error)
        invoke.resolve(o)
    }

    @Command
    fun musicDuck(invoke: Invoke) {
        MusicEngine.duck(invoke.parseArgs(DuckArgs::class.java).hold)
        invoke.resolve()
    }

    @Command
    fun musicMute(invoke: Invoke) {
        MusicEngine.mute(invoke.parseArgs(MuteArgs::class.java).muted)
        invoke.resolve()
    }

    @Command
    fun musicStop(invoke: Invoke) {
        MusicEngine.stop()
        invoke.resolve()
    }
}
