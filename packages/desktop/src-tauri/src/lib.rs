// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::Command;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let resource_path = app.path().resolve("index.js", tauri::path::BaseDirectory::Resource)
                .expect("failed to resolve proxy resource");
            
            // Spawn node to run the bundled proxy
            app.shell().command("node")
                .args([resource_path.to_str().unwrap()])
                .spawn()
                .expect("failed to spawn proxy sidecar");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
