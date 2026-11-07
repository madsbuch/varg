package com.varg.gps

import android.location.Location

/**
 * The running total for one run stage. A process-wide singleton because it
 * is written by GpsService (which keeps running while the screen is locked)
 * and read by GpsPlugin whenever the WebView is awake to ask.
 *
 * Distance only counts fixes good enough to trust, and only advances once
 * the athlete has moved further than the fixes' own uncertainty — otherwise
 * standing still at the pull-up bar slowly "runs" a few hundred metres of
 * GPS jitter.
 */
object RunTracker {
    /** Fixes worse than this (metres, 68% radius) are ignored outright. */
    private const val MAX_ACCURACY = 25f
    /** A step implying more than this (m/s, ~36 km/h) is a GPS jump, not running. */
    private const val MAX_SPEED = 10f
    /** Never count steps shorter than this, however good the fix. */
    private const val MIN_STEP = 4f

    @get:Synchronized var running = false; private set
    @get:Synchronized var startedAtMs = 0L; private set
    @get:Synchronized var targetMeters = 0.0; private set
    @get:Synchronized var meters = 0.0; private set
    /** Wall-clock ms when `meters` first reached the target; 0 until then. */
    @get:Synchronized var crossedAtMs = 0L; private set
    @get:Synchronized var fixes = 0; private set
    @get:Synchronized var lastAccuracy = -1f; private set
    @get:Synchronized var lastFixAtMs = 0L; private set
    @get:Synchronized var error: String? = null

    private var anchor: Location? = null

    @Synchronized
    fun reset(target: Double, startMeters: Double) {
        running = true
        startedAtMs = System.currentTimeMillis()
        targetMeters = target
        meters = startMeters
        crossedAtMs = 0L
        fixes = 0
        lastAccuracy = -1f
        lastFixAtMs = 0L
        error = null
        anchor = null
    }

    @Synchronized
    fun stop() {
        running = false
        anchor = null
    }

    /** Feed one fix. Returns true when this fix crossed the target. */
    @Synchronized
    fun onFix(loc: Location): Boolean {
        if (!running) return false
        val now = System.currentTimeMillis()
        fixes += 1
        lastAccuracy = if (loc.hasAccuracy()) loc.accuracy else -1f
        lastFixAtMs = now
        if (!loc.hasAccuracy() || loc.accuracy > MAX_ACCURACY) return false

        val from = anchor
        if (from == null) {
            anchor = loc
            return false
        }
        val step = from.distanceTo(loc)
        val seconds = (loc.elapsedRealtimeNanos - from.elapsedRealtimeNanos) / 1e9
        if (seconds <= 0) return false
        if (step / seconds > MAX_SPEED) {
            // A jump: re-anchor without counting it, so a genuine relocation
            // is followed rather than rejected forever.
            anchor = loc
            return false
        }
        if (step < maxOf(MIN_STEP, (from.accuracy + loc.accuracy) / 2f)) return false

        meters += step
        anchor = loc
        if (targetMeters > 0 && crossedAtMs == 0L && meters >= targetMeters) {
            crossedAtMs = now
            return true
        }
        return false
    }
}
