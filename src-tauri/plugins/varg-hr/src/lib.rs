//! Bluetooth LE link to a heart-rate chest strap, for every workout player.
//!
//! The Kotlin side (android/) scans for straps advertising the standard
//! Heart Rate Service (0x180D), connects, reconnects after a dropout, and
//! keeps the raw Heart Rate Measurement packets; the frontend drains and
//! parses them (src/lib/hr.ts), where the byte layout is unit-tested.
//! Elsewhere the commands fail loudly — the browser build simulates a strap.

use serde_json::Value;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
struct Hr<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "android")]
fn call<R: Runtime>(app: &tauri::AppHandle<R>, method: &str, args: Value) -> Result<Value, String> {
    app.state::<Hr<R>>()
        .0
        .run_mobile_plugin::<Value>(method, args)
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
fn call<R: Runtime>(_app: &tauri::AppHandle<R>, _method: &str, _args: Value) -> Result<Value, String> {
    Err("The heart-rate strap link is only available in the Android app.".into())
}

#[tauri::command]
async fn ensure_permissions<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Value, String> {
    call(&app, "ensurePermissions", Value::Null)
}

#[tauri::command]
async fn scan<R: Runtime>(app: tauri::AppHandle<R>, seconds: u32) -> Result<Value, String> {
    call(&app, "scan", serde_json::json!({ "seconds": seconds }))
}

#[tauri::command]
async fn connect<R: Runtime>(app: tauri::AppHandle<R>, address: String) -> Result<Value, String> {
    call(&app, "connect", serde_json::json!({ "address": address }))
}

#[tauri::command]
async fn disconnect<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Value, String> {
    call(&app, "disconnect", Value::Null)
}

#[tauri::command]
async fn read<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Value, String> {
    call(&app, "read", Value::Null)
}

#[tauri::command]
async fn start_service<R: Runtime>(app: tauri::AppHandle<R>, title: String) -> Result<Value, String> {
    call(&app, "startService", serde_json::json!({ "title": title }))
}

#[tauri::command]
async fn workout<R: Runtime>(app: tauri::AppHandle<R>, active: bool) -> Result<Value, String> {
    call(&app, "workout", serde_json::json!({ "active": active }))
}

#[tauri::command]
async fn stop_service<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Value, String> {
    call(&app, "stopService", Value::Null)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("varg-hr")
        .invoke_handler(tauri::generate_handler![
            ensure_permissions, scan, connect, disconnect, read, start_service, workout, stop_service
        ])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("com.varg.hr", "HrPlugin")?;
                _app.manage(Hr(handle));
            }
            Ok(())
        })
        .build()
}
