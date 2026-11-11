package com.varg.hr

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

val HEART_RATE: UUID = uuid16(0x180D)
val HR_MEASUREMENT: UUID = uuid16(0x2A37)
private val CCCD = uuid16(0x2902)

/** One raw Heart Rate Measurement, as the frontend parses it. */
data class Packet(val hex: String, val t: Long)

/**
 * The strap connection, process-wide. It lives outside the plugin so the
 * workout's foreground service keeps it — and keeps recording — while the
 * phone is locked and the WebView frozen. The frontend drains `packets`
 * when it is awake and replays them in order.
 *
 * A chest strap drops out routinely: it is taken off, it slips, the body
 * blocks the radio. While a strap is wanted, a dropout is not the end:
 * the link reconnects on its own (autoConnect waits for the strap to
 * come back) and reports "reconnecting", which the player shows in red.
 */
object HrLink {
    /** About 14 hours at one packet a second; the oldest go first beyond that. */
    private const val MAX_PACKETS = 50_000

    private val packets = ArrayDeque<Packet>()
    private var gatt: BluetoothGatt? = null
    private var device: BluetoothDevice? = null
    private var appContext: Context? = null
    @Volatile var state = "disconnected"; private set
    @Volatile var deviceName = ""; private set
    @Volatile var error: String? = null
    @Volatile var lastPacketAt = 0L; private set

    @Synchronized
    fun drain(): List<Packet> {
        val out = packets.toList()
        packets.clear()
        return out
    }

    @Synchronized
    private fun enqueue(value: ByteArray) {
        val now = System.currentTimeMillis()
        packets.addLast(Packet(value.joinToString("") { String.format("%02x", it) }, now))
        lastPacketAt = now
        while (packets.size > MAX_PACKETS) packets.removeFirst()
    }

    private val callback = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                state = "discovering"
                error = null
                g.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                g.close()
                synchronized(this@HrLink) {
                    if (gatt != g) return
                    gatt = null
                    if (state == "disconnected") return // we asked for it
                    error = "The strap disconnected (status $status). Reconnecting…"
                    reconnect()
                }
            }
        }

        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            val ch = g.getService(HEART_RATE)?.getCharacteristic(HR_MEASUREMENT)
            if (ch == null) {
                error = "This device has no heart-rate data (Heart Rate Service)."
                synchronized(this@HrLink) { state = "disconnected" }
                g.disconnect()
                return
            }
            g.setCharacteristicNotification(ch, true)
            val d = ch.getDescriptor(CCCD)
            if (d == null) {
                error = "The strap does not allow notifications."
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
            if (ch.uuid == HR_MEASUREMENT) enqueue(value)
        }

        @Deprecated("Deprecated in Java")
        override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic) {
            if (Build.VERSION.SDK_INT < 33 && ch.uuid == HR_MEASUREMENT) {
                @Suppress("DEPRECATION")
                enqueue(ch.value ?: return)
            }
        }
    }

    /** Wait for the strap to come back: autoConnect has no timeout. */
    @SuppressLint("MissingPermission")
    private fun reconnect() {
        val ctx = appContext ?: return
        val dev = device ?: return
        state = "reconnecting"
        gatt = dev.connectGatt(ctx, true, callback, BluetoothDevice.TRANSPORT_LE)
    }

    @SuppressLint("MissingPermission")
    @Synchronized
    fun connect(context: Context, dev: BluetoothDevice) {
        // Already on this strap: keep the connection and its queue.
        if (device?.address == dev.address && state != "disconnected") return
        gatt?.let {
            it.disconnect()
            it.close()
        }
        packets.clear()
        error = null
        device = dev
        deviceName = dev.name ?: dev.address
        // Application context: the connection must outlive the activity.
        val ctx = context.applicationContext
        appContext = ctx
        state = "connecting"
        gatt = dev.connectGatt(ctx, false, callback, BluetoothDevice.TRANSPORT_LE)
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
        device = null
        packets.clear()
    }
}
