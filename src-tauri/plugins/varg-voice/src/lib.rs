//! Spoken cues for the guided players ("Warrior two, left side").
//!
//! Android's WebView has no Web Speech synthesis, so speech goes through the
//! platform TextToSpeech engine in Kotlin (android/). Elsewhere the commands
//! fail loudly and the frontend uses the browser's own speech, if any.

use serde_json::Value;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
struct Voice<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "android")]
fn call<R: Runtime>(app: &tauri::AppHandle<R>, method: &str, args: Value) -> Result<Value, String> {
    app.state::<Voice<R>>()
        .0
        .run_mobile_plugin::<Value>(method, args)
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
fn call<R: Runtime>(_app: &tauri::AppHandle<R>, _method: &str, _args: Value) -> Result<Value, String> {
    Err("Native speech is only available in the Android app.".into())
}

#[tauri::command]
async fn speak<R: Runtime>(app: tauri::AppHandle<R>, text: String) -> Result<Value, String> {
    call(&app, "speak", serde_json::json!({ "text": text }))
}

#[tauri::command]
async fn stop<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Value, String> {
    call(&app, "stop", Value::Null)
}

#[tauri::command]
async fn status<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Value, String> {
    call(&app, "status", Value::Null)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("varg-voice")
        .invoke_handler(tauri::generate_handler![speak, stop, status])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("com.varg.voice", "VoicePlugin")?;
                _app.manage(Voice(handle));
            }
            Ok(())
        })
        .build()
}
