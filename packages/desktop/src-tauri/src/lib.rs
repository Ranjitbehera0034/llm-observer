// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;

#[tauri::command]
fn notify(app: tauri::AppHandle, title: String, body: String) {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .unwrap();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // ... setup tray ...
            // Setup Tray Menu
            let quit_i = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let show_i = MenuItemBuilder::with_id("show", "Show Dashboard").build(app)?;
            let hide_i = MenuItemBuilder::with_id("hide", "Hide to Tray").build(app)?;
            
            let menu = MenuBuilder::new(app)
                .items(&[&show_i, &hide_i, &quit_i])
                .build()?;

            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        let window = app.get_webview_window("main").unwrap();
                        window.show().unwrap();
                        window.set_focus().unwrap();
                    }
                    "hide" => {
                        let window = app.get_webview_window("main").unwrap();
                        window.hide().unwrap();
                    }
                    _ => {}
                })
                .build(app)?;

            // Spawn proxy sidecar. The sidecar binary is a plain copy of the
            // Node runtime that built it (see packages/proxy/scripts/build-sidecar.js)
            // rather than a `pkg`-snapshotted single file -- pkg's native-module
            // handling doesn't work reliably for better-sqlite3. Because of that,
            // it needs the actual server script passed as an argument, resolved
            // to wherever this install's bundled resources actually landed.
            let server_script = app.path()
                .resolve("resources/proxy/server.js", tauri::path::BaseDirectory::Resource)
                .expect("failed to resolve bundled proxy server.js");

            let sidecar = app.shell().sidecar("llm-observer-proxy")
                .expect("failed to create sidecar")
                .args([server_script.to_string_lossy().to_string()]);

            let (mut rx, _child) = sidecar.spawn()
                .expect("failed to spawn proxy sidecar");
            
            // Listen to sidecar events for alerts
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                use tauri_plugin_notification::NotificationExt;

                while let Some(event) = rx.recv().await {
                    if let CommandEvent::Stdout(line) = event {
                        let line_str = String::from_utf8_lossy(&line);
                        if line_str.contains("[ALERT] BUDGET_EXCEEDED") {
                            let msg = line_str.split("BUDGET_EXCEEDED: ").nth(1).unwrap_or("Budget limit reached.");
                            let _ = app_handle.notification()
                                .builder()
                                .title("Budget Limit Reached")
                                .body(msg)
                                .show();
                        }
                    }
                }
            });

            // Periodically check health and update tray (MVP: Tooltip + Icon)
            let tray_handle = tray.clone();
            
            std::thread::spawn(move || {
                let client = reqwest::blocking::Client::new();
                
                // Pre-load icons
                // Note: In production, icons are bundled. For dev, we try to load from the source dir.
                let icon_green = tauri::image::Image::from_path("icons/tray-green.png").ok();
                let icon_red = tauri::image::Image::from_path("icons/tray-red.png").ok();

                loop {
                    let status = client.get("http://localhost:4000/health").send();
                    match status {
                        Ok(res) if res.status().is_success() => {
                            let _ = tray_handle.set_tooltip(Some("LLM Observer: Online"));
                            if let Some(ref icon) = icon_green {
                                let _ = tray_handle.set_icon(Some(icon.clone()));
                            }
                        }
                        _ => {
                            let _ = tray_handle.set_tooltip(Some("LLM Observer: Offline (Starting...)"));
                            if let Some(ref icon) = icon_red {
                                let _ = tray_handle.set_icon(Some(icon.clone()));
                            }
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_secs(5));
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                window.hide().unwrap();
                api.prevent_close();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![greet, notify])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
