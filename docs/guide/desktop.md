# LLM Observer desktop app (Tauri)

The desktop app is a Tauri 2 window around the same dashboard you get from `llm-observer start`, plus a
tray icon. It bundles its own copy of the server, so Node.js does not have to be installed.

This page says how the pieces find each other and, in the last section, exactly what has been checked and
what has not. Read that section before relying on the app.

## How it works

```
 Tauri window (webview)                         bundled server ("sidecar")
 origin: tauri://localhost        --HTTP-->     http://127.0.0.1:4001   dashboard API (/api/...)
         (http://tauri.localhost                http://127.0.0.1:4000   proxy (/v1/<provider>/..., /health)
          on Windows)
 serves only the dashboard's
 static files
```

- The window loads the production dashboard build (`packages/dashboard/dist`) from Tauri's own asset origin.
  That origin serves static files only, so the dashboard cannot use relative `/api/...` URLs there (it does
  in the browser and npm builds, where the API server serves the page itself).
- The sidecar is a copy of the Node binary that built it plus `resources/proxy/server.js`, started by
  `packages/desktop/src-tauri/src/lib.rs` with explicit settings:

  | Setting | Value |
  |---|---|
  | `LLM_OBSERVER_HOST` | always `127.0.0.1` (the desktop app never binds the LAN) |
  | `LLM_OBSERVER_PORT` (dashboard API) | `4001`, or your own `LLM_OBSERVER_PORT` / legacy `DASHBOARD_PORT` |
  | `LLM_OBSERVER_PROXY_PORT` (proxy) | `4000`, or your own `LLM_OBSERVER_PROXY_PORT` / legacy `PROXY_PORT` |
  | `LLM_OBSERVER_PARENT_PID` | the app's pid; the server shuts itself down if the app dies without cleaning up |

  The data directory is the usual one (`~/.llm-observer`, or `LLM_OBSERVER_DATA_DIR`), so the desktop app and
  the CLI share one database.
- **How the window learns the port.** Before any page script runs, the app injects
  `window.__LLM_OBSERVER_API_BASE__ = "http://127.0.0.1:<api port>"`. The dashboard (`packages/dashboard/src/apiBase.ts`)
  uses it only when it is running inside the desktop webview (`tauri://localhost`, `http://tauri.localhost`,
  `https://tauri.localhost`) and only if it is a loopback `http://` origin with a port; anything else falls back
  to `http://127.0.0.1:4001`.

  | Where the dashboard runs | API base |
  |---|---|
  | npm / Docker / any browser on the server's own port | empty: same-origin relative URLs, any port |
  | `vite dev` | `http://localhost:4001` |
  | desktop webview | injected `http://127.0.0.1:<port>`, default `http://127.0.0.1:4001` |
  | build with `VITE_API_BASE_URL` set | that value, always |

- **Startup.** The app starts the sidecar, waits (up to 30 seconds) until the API port accepts connections, then
  opens the window, so the first page load does not race the server. If the server never comes up the window
  opens anyway and the dashboard shows its normal error states; the sidecar's stderr goes to the app's stderr.
- **Ports already in use.** If something already listens on the configured port, for example a running
  `llm-observer start`, the sidecar exits with a "port already in use" message and the window talks to whatever
  is on that port. When that is another LLM Observer, it works and shares the same data; when it is some other
  program, the dashboard shows errors. Set `LLM_OBSERVER_PORT` / `LLM_OBSERVER_PROXY_PORT` before launching to
  use other ports.
- **Quitting.** "Quit" in the tray menu exits the app and Tauri's shell plugin stops the sidecar. Closing the
  window only hides it to the tray. If the app is killed some other way (SIGTERM, SIGKILL, a crash) the sidecar
  notices within a few seconds (it checks every two) and shuts down gracefully, which frees its ports.
- **Security.** The server's Host/Origin guard accepts exactly these desktop origins and no others (no port, no
  subdomain, no other scheme): `tauri://localhost`, `http://tauri.localhost`, `https://tauri.localhost`. The CORS
  allowlist names the same three. The webview is not allowed to start processes (the `shell:allow-spawn`
  permission was removed; only the Rust side starts the sidecar). The Tauri content security policy is still
  `null`, i.e. not locked down.

## Running it

Download an installer from the [Releases page](https://github.com/Ranjitbehera0034/llm-observer/releases).
`release.yml` is set up to build for macOS (the `macos-latest` runner, which is Apple Silicon, so no Intel Mac
build), Windows and Linux. What a given release actually contains is whatever was uploaded; check the assets.

**The installers are not signed by Apple or Microsoft.** `SIGNING.md` covers only the updater's minisign
signature. Expect a Gatekeeper warning on macOS and a SmartScreen warning on Windows.

## Building from source (Linux, checked on Ubuntu 24.04)

```bash
# system libraries (Tauri v2 prerequisites)
sudo apt-get install -y libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \
  libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libssl-dev patchelf build-essential pkg-config
# Rust (rustup) and Node 20+ are also required

npm ci
npm run build --workspace=@llm-observer/database
npm run build --workspace=@llm-observer/dashboard      # the window's frontendDist
npm run build:sidecar --workspace=@llm-observer/proxy  # bin/ and resources/ for the bundle
node packages/desktop/scripts/check-sidecar.cjs        # optional: boots the sidecar and probes it

cd packages/desktop
npm run tauri -- build --debug --bundles deb           # or omit --debug --bundles for the release bundles
```

`.github/workflows/desktop-check.yml` runs the same prerequisites, sidecar build, `cargo check` and the Rust unit
tests on every change to the desktop package. It does not open a window.

To run the built binary on a machine without a display: `xvfb-run -a src-tauri/target/debug/desktop`. Set
`LLM_OBSERVER_PORT`, `LLM_OBSERVER_PROXY_PORT` and a throwaway `HOME` / `LLM_OBSERVER_DATA_DIR` when testing so it
does not touch your real data.

## Troubleshooting

- **Empty dashboard or error banners right after launch.** The window opens when the API port answers; if you
  see errors anyway, look at the app's stderr for the sidecar's message (most often a busy port).
- **Tray tooltip says "Offline".** The tray polls the proxy's `/health` every five seconds.
- **Where is my data?** The same place as the CLI's: `~/.llm-observer`.

## What is verified and what is not

Verified on one Linux machine (Ubuntu 24.04, x86_64, Tauri 2.10, WebKitGTK 4.1, under Xvfb), by running things:

| Claim | Evidence |
|---|---|
| The crate compiles, the Rust unit tests pass, `tauri build --debug --bundles deb` produces a package that contains the sidecar, the server, the dashboard and the native SQLite module | the commands above |
| The built app (also the unpacked `.deb`) starts the sidecar on the configured ports, `/health` and the API answer, and the sidecar serves the dashboard | run under Xvfb, probes with `curl` |
| The dashboard in the real WebKitGTK window at `tauri://localhost` reads from the sidecar | data written to the database beforehand showed up on the Overview page |
| A write from that window (adding a subscription) reaches the sidecar through the Origin guard and the CORS preflight | the subscription existed afterwards |
| The live event stream (SSE) connects from that window | one established connection to the API port on the Requests page, none on the Overview |
| The sidecar exits when the app is killed (SIGTERM and SIGKILL) | process list and port probe afterwards |
| `http://tauri.localhost` as the page origin works against the real server (absolute loopback URLs, CORS, guard) | headless Chromium with a host-resolver rule (`tests/integration/desktopWebview.test.ts`; skips when Chromium is absent) |
| The same dashboard build still uses same-origin relative URLs in a browser | same test, control case |
| The guard refuses look-alike origins | `packages/proxy/src/__tests__/unit/desktopOrigins.test.ts` |

Not verified:

- **macOS (WKWebView) and Windows (WebView2).** Nothing here ran on either. The Windows origin
  `http://tauri.localhost` is covered by the Chromium test (the same origin string, but Playwright's Chromium,
  not WebView2 itself); `https://tauri.localhost` (when an app sets `useHttpsScheme`) is only covered by origin-matching
  unit tests. Whether each platform's webview allows a `tauri://` or `tauri.localhost` page to call
  `http://127.0.0.1` was not tested there.
- **Signing and installing.** No OS code signing or notarisation exists. The updater public key in
  `tauri.conf.json` was not checked against a private key in the release secrets. A release build through
  `release.yml` was never run from here.
- **Auto-update.** The updater plugin is registered, but nothing calls it: there is no update check in the Rust
  code or in the dashboard, so the app does not update itself. The endpoint and signature flow are untested.
- **Auto-start on login.** The autostart plugin is registered but nothing enables it, and the `--minimized` argument it
  would pass is not read, so the app does not start on login and always opens its window.
- **Native budget notifications.** The app notifies when the sidecar prints a line containing
  `[ALERT] BUDGET_EXCEEDED`, but the server never prints one, so these notifications do not fire. Nothing was
  tested through the OS notification service.
- **Tray icon colours.** The green and red icons are loaded from a relative path (`icons/tray-*.png`)
  and are not shipped as bundle resources, so in an installed build they most likely fail to load and only the
  tooltip text ("Online" / "Offline") changes. Xvfb has no tray, so the tray itself was not exercised.
- **Default ports on a normal machine.** Tests used ports 16000-16049 through the environment variables; the
  4000/4001 defaults are covered by unit tests only.
- **A long-running session**, upgrades from an earlier desktop version, and Linux desktops other than this
  Xvfb setup (Wayland, AppImage packaging).

`packages/desktop/src/` (a "Welcome to Tauri" template page) is not used: the window loads the dashboard build.
