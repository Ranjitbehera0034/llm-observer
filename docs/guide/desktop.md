# LLM Observer Desktop App (Tauri)

The desktop app is the best way to use LLM Observer — it runs invisibly in the background, shows a status indicator in your system tray, and sends native OS notifications when your budget is hit.

## Download

Download the latest release for your platform from the [GitHub Releases page](https://github.com/Ranjitbehera0034/llm-observer/releases).

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `LLM.Observer_x.x.x_aarch64.dmg` |
| macOS (Intel) | `LLM.Observer_x.x.x_x86_64.dmg` |
| Windows | `LLM.Observer_x.x.x_x64_en-US.msi` |
| Linux | `llm-observer_x.x.x_amd64.AppImage` |

## Features

### System Tray Status
- 🟢 **Green dot** — Proxy is running and healthy
- 🔴 **Red dot** — Proxy is starting or stopped
- Right-click tray icon for Quick Actions (Show Dashboard, Quit)

### Native OS Notifications
You get instant desktop notifications when:
- Daily budget limit is reached
- Anomalous spike detected (5× average spend in 1 hour)

### Auto-Start on Login
The app starts automatically when you log into your computer. The proxy runs invisibly in the background — you'll only see the tray icon.

### Auto-Updates
Silent updates are downloaded from GitHub Releases automatically. You'll be notified when an update is ready to install.

## System Requirements

| Platform | Requirement |
|----------|------------|
| macOS | 11.0 (Big Sur) or later |
| Windows | Windows 10 or later |
| Linux | Ubuntu 22.04 or similar |

> **No Node.js required** — the proxy is bundled as a standalone native binary.

## Building from Source

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Tauri CLI
cargo install tauri-cli

# Build the desktop app
cd packages/desktop
npm run tauri build
```

## Troubleshooting

**Proxy shows red dot on startup?**
Normal — the proxy needs ~2 seconds to start. It will turn green automatically.

**App not starting?**
Check the tray icon is visible. The app minimizes to tray by default. Press the tray icon to show the dashboard.
