package com.varg.system

import android.app.Activity
import android.graphics.Color
import androidx.core.view.WindowCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class BarsArgs {
    /** The page background, #rrggbb. */
    var color: String = "#e3e5e3"
    /** Dark theme: light icons. Light theme: dark icons. */
    var dark: Boolean = false
}

/**
 * Colours the status and navigation bars to the app's theme, with icons
 * that read on them. The WebView ignores the page's theme-color, and the
 * activity theme `tauri android init` generates left the status bar black
 * over the light theme.
 */
@TauriPlugin
class SystemPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun systemBars(invoke: Invoke) {
        val a = invoke.parseArgs(BarsArgs::class.java)
        val color = try {
            Color.parseColor(a.color)
        } catch (e: IllegalArgumentException) {
            invoke.reject("Not a colour: ${a.color}")
            return
        }
        activity.runOnUiThread {
            val window = activity.window
            @Suppress("DEPRECATION")
            window.statusBarColor = color
            @Suppress("DEPRECATION")
            window.navigationBarColor = color
            val bars = WindowCompat.getInsetsController(window, window.decorView)
            bars.isAppearanceLightStatusBars = !a.dark
            bars.isAppearanceLightNavigationBars = !a.dark
            invoke.resolve()
        }
    }
}
