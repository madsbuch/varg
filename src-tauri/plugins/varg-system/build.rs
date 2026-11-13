const COMMANDS: &[&str] = &["system_bars"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
