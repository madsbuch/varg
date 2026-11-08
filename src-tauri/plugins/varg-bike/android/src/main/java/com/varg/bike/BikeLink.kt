package com.varg.bike

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.os.Build
import java.util.UUID

fun uuid16(short: Int): UUID =
    UUID.fromString(String.format("0000%04x-0000-1000-8000-00805f9b34fb", short))

val FTMS: UUID = uuid16(0x1826)
val INDOOR_BIKE_DATA: UUID = uuid16(0x2AD2)
val CYCLING_POWER: UUID = uuid16(0x1818)
val POWER_MEASUREMENT: UUID = uuid16(0x2A63)
private val CCCD = uuid16(0x2902)

/** One raw measurement, as the frontend parses it. */
data class Packet(val c: String, val hex: String, val t: Long)

/**
 * The bike connection, process-wide. It lives outside the plugin so the
 * ride's foreground service keeps it — and keeps recording — while the
 * user watches a video in another app and the WebView is frozen. The
 * frontend drains `packets` when it is awake and replays them in order.
 */
object BikeLink {
    /** About 3.5 hours at 4 packets a second; the oldest go first beyond that. */
    private const val MAX_PACKETS = 50_000

    private val packets = ArrayDeque<Packet>()
    private var gatt: BluetoothGatt? = null
    @Volatile var state = "disconnected"; private set
    @Volatile var protocol = ""; private set
    @Volatile var deviceName = ""; private set
    @Volatile var error: String? = null
    /** True while Varg's activity is on screen; set by BikePlugin. */
    @Volatile var appVisible = true
    @Volatile var lastPacketAt = 0L; private set

    @Synchronized
    fun drain(): List<Packet> {
        val out = packets.toList()
        packets.clear()
        return out
    }

    @Synchronized
    private fun enqueue(uuid: UUID, value: ByteArray) {
        val now = System.currentTimeMillis()
        packets.addLast(Packet(
            if (uuid == INDOOR_BIKE_DATA) "2ad2" else "2a63",
            value.joinToString("") { String.format("%02x", it) },
            now,
        ))
        lastPacketAt = now
        while (packets.size > MAX_PACKETS) packets.removeFirst()
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

    @SuppressLint("MissingPermission")
    @Synchronized
    fun connect(context: Context, device: BluetoothDevice) {
        gatt?.let {
            it.disconnect()
            it.close()
        }
        packets.clear()
        error = null
        protocol = ""
        deviceName = device.name ?: device.address
        state = "connecting"
        // Application context: the connection must outlive the activity.
        gatt = device.connectGatt(context.applicationContext, false, callback, BluetoothDevice.TRANSPORT_LE)
    }

    @SuppressLint("MissingPermission")
    @Synchronized
    fun disconnect() {
        state = "disconnected"
        gatt?.let {
            it.disconnect()
            it.close()
        }
        gatt = null
        packets.clear()
    }
}
