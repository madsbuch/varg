#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_varg_gps::init())
        .plugin(tauri_plugin_varg_voice::init())
        .plugin(tauri_plugin_varg_bike::init())
        .plugin(tauri_plugin_varg_hr::init())
        .plugin(tauri_plugin_varg_system::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
