const COMMANDS: &[&str] = &[
    "ensure_permissions", "scan", "connect", "disconnect", "read",
    "start_service", "workout", "stop_service",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
