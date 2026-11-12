const COMMANDS: &[&str] = &[
    "ensure_permissions", "scan", "connect", "disconnect", "read",
    "start_ride", "schedule", "cue_audio", "stop_ride",
    "music_has", "music_song", "music_score", "music_duck", "music_mute", "music_stop",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
