package com.varg.bike

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
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
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue

@InvokeArg
class ScanArgs {
    var seconds: Int = 6
}

@InvokeArg
class ConnectArgs {
    var address: String = ""
}

private fun uuid16(short: Int): UUID =
    UUID.fromString(String.format("0000%04x-0000-1000-8000-00805f9b34fb", short))

private val FTMS = uuid16(0x1826)
private val INDOOR_BIKE_DATA = uuid16(0x2AD2)
private val CYCLING_POWER = uuid16(0x1818)
private val POWER_MEASUREMENT = uuid16(0x2A63)
private val CCCD = uuid16(0x2902)

/**
 * Bluetooth LE link to an indoor bike. Scans for the two standard services
 * bikes use — Fitness Machine (FTMS, power + cadence + energy) and Cycling
 * Power — connects, subscribes to the measurement, and queues every raw
 * packet. The frontend drains the queue and parses the bytes; this side
 * knows nothing about watts. Every failure is a rejected invoke or an
 * `error` in the state the ride player shows.
 */
@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT], alias = "bluetooth"),
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION], alias = "location"),
    ],
)
class BikePlugin(private val activity: Activity) : Plugin(activity) {
    private val main = Handler(Looper.getMainLooper())
    private val packets = ConcurrentLinkedQueue<JSObject>()
    private val found = LinkedHashMap<String, JSObject>()
    private var gatt: BluetoothGatt? = null
    @Volatile private var state = "disconnected"
    @Volatile private var protocol = ""
    @Volatile private var deviceName = ""
    @Volatile private var error: String? = null

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
        requestPermissionForAlias(neededAlias(), invoke, "permissionsDone")
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
                error = "Bluetooth scan failed (code $errorCode)."
            }
        }
        val filters = listOf(
            ScanFilter.Builder().setServiceUuid(ParcelUuid(FTMS)).build(),
            ScanFilter.Builder().setServiceUuid(ParcelUuid(CYCLING_POWER)).build(),
        )
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        error = null
        scanner.startScan(filters, settings, callback)
        main.postDelayed({
            try {
                scanner.stopScan(callback)
            } catch (_: Exception) {}
            val list = JSArray()
            synchronized(found) { found.values.forEach { list.put(it) } }
            val o = JSObject()
            o.put("devices", list)
            error?.let { o.put("error", it) }
            invoke.resolve(o)
        }, args.seconds.coerceIn(2, 20) * 1000L)
    }

    private val callback = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                state = "discovering"
                g.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                if (state != "disconnected") error = "The bike disconnected (status $status)."
                state = "disconnected"
                g.close()
                if (gatt == g) gatt = null
            }
        }

        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            // Prefer FTMS: it carries cadence and energy as well as power.
            val ch = g.getService(FTMS)?.getCharacteristic(INDOOR_BIKE_DATA)?.also { protocol = "ftms" }
                ?: g.getService(CYCLING_POWER)?.getCharacteristic(POWER_MEASUREMENT)?.also { protocol = "cps" }
            if (ch == null) {
                error = "This device has no bike power data (FTMS or Cycling Power)."
                state = "disconnected"
                g.disconnect()
                return
            }
            g.setCharacteristicNotification(ch, true)
            val d = ch.getDescriptor(CCCD)
            if (d == null) {
                error = "The bike does not allow notifications."
                return
            }
            if (Build.VERSION.SDK_INT >= 33) {
                g.writeDescriptor(d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
            } else {
                @Suppress("DEPRECATION")
                d.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                @Suppress("DEPRECATION")
                g.writeDescriptor(d)
            }
            state = "connected"
        }

        // Android 13+ delivers the value directly; older versions read it off
        // the characteristic. Both land in the same queue.
        override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic, value: ByteArray) {
            enqueue(ch.uuid, value)
        }

        @Deprecated("Deprecated in Java")
        override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic) {
            if (Build.VERSION.SDK_INT < 33) {
                @Suppress("DEPRECATION")
                enqueue(ch.uuid, ch.value ?: return)
            }
        }
    }

    private fun enqueue(uuid: UUID, value: ByteArray) {
        val o = JSObject()
        o.put("c", if (uuid == INDOOR_BIKE_DATA) "2ad2" else "2a63")
        o.put("hex", value.joinToString("") { String.format("%02x", it) })
        o.put("t", System.currentTimeMillis())
        packets.add(o)
        while (packets.size > 600) packets.poll()
    }

    @SuppressLint("MissingPermission")
    @Command
    fun connect(invoke: Invoke) {
        if (refuse(invoke)) return
        val args = invoke.parseArgs(ConnectArgs::class.java)
        val device: BluetoothDevice = try {
            adapter()!!.getRemoteDevice(args.address)
        } catch (e: Exception) {
            invoke.reject("Unknown bike address ${args.address}.")
            return
        }
        gatt?.let {
            it.disconnect()
            it.close()
        }
        packets.clear()
        error = null
        protocol = ""
        deviceName = device.name ?: args.address
        state = "connecting"
        gatt = device.connectGatt(activity, false, callback, BluetoothDevice.TRANSPORT_LE)
        invoke.resolve(snapshot(false))
    }

    @SuppressLint("MissingPermission")
    @Command
    fun disconnect(invoke: Invoke) {
        state = "disconnected"
        gatt?.let {
            it.disconnect()
            it.close()
        }
        gatt = null
        packets.clear()
        invoke.resolve(snapshot(false))
    }

    /** State plus every packet since the last read. */
    @Command
    fun read(invoke: Invoke) {
        invoke.resolve(snapshot(true))
    }

    private fun snapshot(drain: Boolean): JSObject {
        val o = JSObject()
        o.put("state", state)
        o.put("protocol", protocol)
        o.put("name", deviceName)
        error?.let { o.put("error", it) }
        val list = JSArray()
        if (drain) {
            while (true) list.put(packets.poll() ?: break)
        }
        o.put("packets", list)
        return o
    }
}
