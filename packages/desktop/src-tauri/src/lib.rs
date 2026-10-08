// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

mod config;

use std::net::{SocketAddr, TcpStream};
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;

/// Block until something accepts connections on the loopback port, or `timeout` passes.
fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

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
            //
            // The ports are passed explicitly (default 4001 for the API, 4000 for
            // the proxy; LLM_OBSERVER_PORT / LLM_OBSERVER_PROXY_PORT override) and
            // the server is pinned to loopback. The webview is told the API port
            // through an initialization script below.
            let ports = config::ports_from_env();

            let resolve = |rel: &str| app.path().resolve(rel, tauri::path::BaseDirectory::Resource);
            match (resolve("resources/proxy/server.js"), resolve("resources/proxy/parent-watch.js")) {
                (Err(e), _) | (_, Err(e)) => eprintln!("[llm-observer] cannot locate the bundled server: {e}"),
                (Ok(server_script), Ok(parent_watch)) => {
                    match app.shell().sidecar("llm-observer-proxy") {
                        Err(e) => eprintln!("[llm-observer] cannot create the sidecar command: {e}"),
                        Ok(cmd) => {
                            // parent-watch.js makes the server stop when this process dies
                            // without a clean exit (SIGTERM/SIGKILL, crash, logout).
                            let cmd = cmd
                                .args([
                                    "--require".to_string(),
                                    parent_watch.to_string_lossy().to_string(),
                                    server_script.to_string_lossy().to_string(),
                                ])
                                .env("LLM_OBSERVER_PARENT_PID", std::process::id().to_string())
                                .env("LLM_OBSERVER_HOST", config::LOOPBACK_HOST)
                                .env("LLM_OBSERVER_PORT", ports.api.to_string())
                                .env("LLM_OBSERVER_PROXY_PORT", ports.proxy.to_string());
                            match cmd.spawn() {
                                Err(e) => eprintln!("[llm-observer] failed to spawn the sidecar: {e}"),
                                Ok((mut rx, _child)) => {
                                    // Listen to sidecar events for alerts and for an early exit
                                    // (for example a port that is already taken).
                                    let app_handle = app.handle().clone();
                                    tauri::async_runtime::spawn(async move {
                                        use tauri_plugin_shell::process::CommandEvent;
                                        use tauri_plugin_notification::NotificationExt;

                                        while let Some(event) = rx.recv().await {
                                            match event {
                                                CommandEvent::Stdout(line) => {
                                                    // Not forwarded to this process's own stdout: the
                                                    // server prints a one-time API key on first run.
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
                                                CommandEvent::Stderr(line) => {
                                                    eprintln!("[sidecar] {}", String::from_utf8_lossy(&line).trim_end());
                                                }
                                                CommandEvent::Error(e) => eprintln!("[sidecar] error: {e}"),
                                                CommandEvent::Terminated(payload) => {
                                                    eprintln!("[sidecar] exited (code {:?}, signal {:?})", payload.code, payload.signal);
                                                }
                                                _ => {}
                                            }
                                        }
                                    });
                                }
                            }
                        }
                    }
                }
            }

            // Open the main window once the server accepts connections (or after a
            // timeout, so a failure shows up as the dashboard's own error states instead
            // of as no window at all). The page learns the API base from the init script.
            let window_handle = app.handle().clone();
            let api_port = ports.api;
            std::thread::spawn(move || {
                if !wait_for_port(api_port, Duration::from_secs(30)) {
                    eprintln!("[llm-observer] nothing is listening on 127.0.0.1:{api_port} after 30s; opening the window anyway");
                }
                let Some(window_config) = window_handle.config().app.windows.first().cloned() else {
                    eprintln!("[llm-observer] no window configured in tauri.conf.json");
                    return;
                };
                let built = tauri::WebviewWindowBuilder::from_config(&window_handle, &window_config)
                    .and_then(|b| b.initialization_script(config::init_script(api_port)).build());
                if let Err(e) = built {
                    eprintln!("[llm-observer] failed to create the main window: {e}");
                }
            });

            // Periodically check health and update tray (MVP: Tooltip + Icon)
            let tray_handle = tray.clone();
            let health_url = format!("http://{}:{}/health", config::LOOPBACK_HOST, ports.proxy);

            std::thread::spawn(move || {
                let client = reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(3))
                    .build()
                    .expect("failed to build the health-check HTTP client");
                
                // Pre-load icons
                // Note: In production, icons are bundled. For dev, we try to load from the source dir.
                let icon_green = tauri::image::Image::from_path("icons/tray-green.png").ok();
                let icon_red = tauri::image::Image::from_path("icons/tray-red.png").ok();

                loop {
                    let status = client.get(&health_url).send();
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
