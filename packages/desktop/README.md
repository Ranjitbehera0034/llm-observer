# LLM Observer desktop app

Tauri 2 shell around the dashboard and a bundled copy of the server (the "sidecar").

- How the window finds the API, the ports, and what is and is not verified: [docs/guide/desktop.md](../../docs/guide/desktop.md)
- Rust side: `src-tauri/src/lib.rs` (sidecar, tray, window) and `src-tauri/src/config.rs` (ports, injected API base)
- Sidecar bundle: `npm run build:sidecar --workspace=@llm-observer/proxy`, then `node scripts/check-sidecar.cjs` to boot and probe it
- Releases and the updater signature: [SIGNING.md](SIGNING.md)

`src/` holds an unused "Welcome to Tauri" template page; the window loads `packages/dashboard/dist`.
