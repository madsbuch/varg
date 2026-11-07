const COMMANDS: &[&str] = &["speak", "stop", "status"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
