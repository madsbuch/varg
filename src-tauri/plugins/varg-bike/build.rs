const COMMANDS: &[&str] = &[
    "ensure_permissions", "scan", "connect", "disconnect", "read",
    "start_ride", "schedule", "cue_audio", "stop_ride",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
