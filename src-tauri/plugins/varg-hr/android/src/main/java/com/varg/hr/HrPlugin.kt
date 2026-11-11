package com.varg.hr

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
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
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

@InvokeArg
class ScanArgs {
    var seconds: Int = 6
}

@InvokeArg
class ConnectArgs {
    var address: String = ""
}

@InvokeArg
class StartServiceArgs {
    var title: String = "Workout"
}

/**
 * Bluetooth LE link to a heart-rate strap, plus the workout's background
 * service. Scans for the standard Heart Rate Service — every Bluetooth
 * chest strap (Garmin HRM 600, HRM-Pro, Polar H10, …) speaks it — and
 * hands the connection to HrLink, which records raw packets for the
 * frontend to parse. Every failure is a rejected invoke or an `error` in
 * the state the players show.
 */
@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT], alias = "bluetooth"),
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION], alias = "location"),
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
    ],
)
class HrPlugin(private val activity: Activity) : Plugin(activity) {
    private val main = Handler(Looper.getMainLooper())
    private val found = LinkedHashMap<String, JSObject>()

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
        // Android 13+: also the notification, so a locked-phone workout
        // shows whether the strap is still delivering. Recording works without it.
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
                val o = JSObject()
                o.put("address", result.device.address)
                o.put("name", result.scanRecord?.deviceName ?: result.device.name ?: "Unnamed strap")
                o.put("rssi", result.rssi)
                synchronized(found) { found[result.device.address] = o }
            }

            override fun onScanFailed(errorCode: Int) {
                scanError = "Bluetooth scan failed (code $errorCode)."
            }
        }
        val filters = listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(HEART_RATE)).build())
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
            invoke.reject("Unknown strap address ${args.address}.")
            return
        }
        HrLink.connect(activity, device)
        invoke.resolve(snapshot(false))
    }

    @Command
    fun disconnect(invoke: Invoke) {
        HrLink.disconnect()
        invoke.resolve(snapshot(false))
    }

    /** State plus every packet since the last read — all of them, however long Varg was away. */
    @Command
    fun read(invoke: Invoke) {
        invoke.resolve(snapshot(true))
    }

    private fun snapshot(drain: Boolean): JSObject {
        val o = JSObject()
        o.put("state", HrLink.state)
        o.put("name", HrLink.deviceName)
        o.put("background", HrService.running)
        HrService.startError?.let { o.put("serviceError", it) }
        HrLink.error?.let { o.put("error", it) }
        val list = JSArray()
        if (drain) {
            for (p in HrLink.drain()) {
                val j = JSObject()
                j.put("hex", p.hex)
                j.put("t", p.t)
                list.put(j)
            }
        }
        o.put("packets", list)
        return o
    }

    /** Start the background service for a workout: notification and recording. */
    @Command
    fun startService(invoke: Invoke) {
        val args = invoke.parseArgs(StartServiceArgs::class.java)
        // Android 14+ kills the whole app if a connected-device foreground
        // service starts without Bluetooth permission. Check first, refuse
        // with a reason — never start a service that cannot start.
        if (Build.VERSION.SDK_INT >= 31 &&
            ContextCompat.checkSelfPermission(activity, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
        ) {
            invoke.reject("Bluetooth permission is not granted — pair your strap in Settings → Heart rate.")
            return
        }
        HrService.title = args.title
        try {
            ContextCompat.startForegroundService(
                activity,
                Intent(activity, HrService::class.java).setAction(HrService.ACTION_START),
            )
        } catch (e: Exception) {
            invoke.reject("Could not keep heart rate recording in the background: ${e.message}")
            return
        }
        invoke.resolve()
    }

    @Command
    fun stopService(invoke: Invoke) {
        if (HrService.running) {
            activity.startService(Intent(activity, HrService::class.java).setAction(HrService.ACTION_STOP))
        }
        invoke.resolve()
    }
}
