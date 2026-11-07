//! Run tracking for Varg's for-time player.
//!
//! On Android the work happens in Kotlin (android/): a foreground location
//! service that keeps accumulating distance while the screen is locked and
//! the WebView is frozen, and records the wall-clock moment the target
//! distance was crossed. These commands only forward to it. On every other
//! platform they fail loudly — the frontend never offers GPS there.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
use tauri::Manager;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartArgs {
    /// Distance in metres at which the crossing time is recorded; 0 for none.
    pub target_meters: f64,
    /// Distance already covered in this stage (resuming after an undo).
    pub start_meters: f64,
}

#[cfg(target_os = "android")]
struct Gps<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "android")]
fn call<R: Runtime>(app: &tauri::AppHandle<R>, method: &str, args: Value) -> Result<Value, String> {
    app.state::<Gps<R>>()
        .0
        .run_mobile_plugin::<Value>(method, args)
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
fn call<R: Runtime>(_app: &tauri::AppHandle<R>, _method: &str, _args: Value) -> Result<Value, String> {
    Err("GPS run tracking is only available in the Android app.".into())
}

#[tauri::command]
async fn check_permissions<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Value, String> {
    call(&app, "checkPermissions", Value::Null)
}

#[tauri::command]
async fn request_permissions<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Value, String> {
    call(&app, "requestPermissions", serde_json::json!({ "permissions": ["location"] }))
}

#[tauri::command]
async fn start<R: Runtime>(
    app: tauri::AppHandle<R>,
    target_meters: f64,
    start_meters: f64,
) -> Result<Value, String> {
    let args = StartArgs { target_meters, start_meters };
    call(&app, "start", serde_json::to_value(args).map_err(|e| e.to_string())?)
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
    Builder::new("varg-gps")
        .invoke_handler(tauri::generate_handler![
            check_permissions,
            request_permissions,
            start,
            stop,
            status
        ])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("com.varg.gps", "GpsPlugin")?;
                _app.manage(Gps(handle));
            }
            Ok(())
        })
        .build()
}
