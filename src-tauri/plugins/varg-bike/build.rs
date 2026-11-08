const COMMANDS: &[&str] = &["ensure_permissions", "scan", "connect", "disconnect", "read"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
