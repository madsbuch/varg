package com.varg.voice

import android.app.Activity
import android.media.AudioAttributes
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.Locale

@InvokeArg
class SpeakArgs {
    var text: String = ""
}

/**
 * The phone's text-to-speech engine, for pose names in the guided players.
 * Initialisation is asynchronous; until it finishes, speak() is refused with
 * the reason, so the player can say "voice unavailable" instead of going
 * quietly silent.
 */
@TauriPlugin
class VoicePlugin(private val activity: Activity) : Plugin(activity) {
    private var tts: TextToSpeech? = null
    @Volatile private var ready = false
    @Volatile private var error: String? = "The voice is still starting."

    override fun load(webView: WebView) {
        super.load(webView)
        tts = TextToSpeech(activity.applicationContext) { status ->
            if (status != TextToSpeech.SUCCESS) {
                error = "No text-to-speech engine is available on this phone."
                return@TextToSpeech
            }
            val engine = tts ?: return@TextToSpeech
            val result = engine.setLanguage(Locale.UK)
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                val fallback = engine.setLanguage(Locale.US)
                if (fallback == TextToSpeech.LANG_MISSING_DATA || fallback == TextToSpeech.LANG_NOT_SUPPORTED) {
                    error = "English speech is not installed in the phone's text-to-speech settings."
                    return@TextToSpeech
                }
            }
            engine.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            engine.setSpeechRate(0.95f)
            ready = true
            error = null
        }
    }

    @Command
    fun speak(invoke: Invoke) {
        val args = invoke.parseArgs(SpeakArgs::class.java)
        val engine = tts
        if (!ready || engine == null) {
            invoke.reject(error ?: "The voice is not ready.")
            return
        }
        val result = engine.speak(args.text, TextToSpeech.QUEUE_FLUSH, Bundle(), "varg-cue")
        if (result != TextToSpeech.SUCCESS) {
            invoke.reject("The phone's voice refused to speak.")
            return
        }
        invoke.resolve(snapshot())
    }

    @Command
    fun stop(invoke: Invoke) {
        tts?.stop()
        invoke.resolve(snapshot())
    }

    @Command
    fun status(invoke: Invoke) {
        invoke.resolve(snapshot())
    }

    private fun snapshot(): JSObject {
        val o = JSObject()
        o.put("ready", ready)
        error?.let { o.put("error", it) }
        return o
    }
}
