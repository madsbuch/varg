//! The phone's own bars (status bar at the top, navigation bar at the
//! bottom), coloured to the app's theme.
//!
//! Android's WebView ignores `<meta name="theme-color">`, so without this
//! the bars keep whatever the generated activity theme gives them: a black
//! status bar over the light theme. The frontend (src/lib/theme.ts) calls
//! `system_bars` whenever the theme resolves, including the owner's
//! light/dark choice and the phone switching while on "system". Elsewhere
//! the command fails and the frontend ignores it: a browser has no bars.

use serde_json::Value;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
struct System<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "android")]
fn call<R: Runtime>(app: &tauri::AppHandle<R>, method: &str, args: Value) -> Result<Value, String> {
    app.state::<System<R>>()
        .0
        .run_mobile_plugin::<Value>(method, args)
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
fn call<R: Runtime>(_app: &tauri::AppHandle<R>, _method: &str, _args: Value) -> Result<Value, String> {
    Err("System bars exist only in the Android app.".into())
}

/// `color`: the page background as #rrggbb; `dark`: light icons on it.
#[tauri::command]
async fn system_bars<R: Runtime>(app: tauri::AppHandle<R>, color: String, dark: bool) -> Result<Value, String> {
    call(&app, "systemBars", serde_json::json!({ "color": color, "dark": dark }))
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("varg-system")
        .invoke_handler(tauri::generate_handler![system_bars])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("com.varg.system", "SystemPlugin")?;
                _app.manage(System(handle));
            }
            Ok(())
        })
        .build()
}
