//! Bluetooth LE link to an indoor bike, for Varg's ride player.
//!
//! The Kotlin side (android/) scans for bikes advertising the Fitness
//! Machine Service (FTMS) or the Cycling Power Service, connects, and keeps
//! the raw measurement packets; the frontend drains and parses them
//! (src/lib/bike.ts), where the byte layouts are unit-tested. Elsewhere the
//! commands fail loudly — the browser build uses a simulated bike.

use serde_json::Value;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
struct Bike<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "android")]
fn call<R: Runtime>(app: &tauri::AppHandle<R>, method: &str, args: Value) -> Result<Value, String> {
    app.state::<Bike<R>>()
        .0
        .run_mobile_plugin::<Value>(method, args)
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
fn call<R: Runtime>(_app: &tauri::AppHandle<R>, _method: &str, _args: Value) -> Result<Value, String> {
    Err("The bike link is only available in the Android app.".into())
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

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("varg-bike")
        .invoke_handler(tauri::generate_handler![ensure_permissions, scan, connect, disconnect, read])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("com.varg.bike", "BikePlugin")?;
                _app.manage(Bike(handle));
            }
            Ok(())
        })
        .build()
}
