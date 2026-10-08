//! Where the bundled server listens and how the webview is told.
//!
//! The dashboard inside the webview is served from Tauri's own origin
//! (`tauri://localhost` on macOS and Linux, `http(s)://tauri.localhost` on
//! Windows), so it cannot use relative `/api` URLs. The shell passes the sidecar
//! an explicit loopback port and injects the matching base URL into the page as
//! `window.__LLM_OBSERVER_API_BASE__` before any page script runs
//! (see packages/dashboard/src/apiBase.ts for the reading side).

/// Dashboard/API port of the server, the same default as `llm-observer start`.
pub const DEFAULT_API_PORT: u16 = 4001;
/// Proxy port (`/v1/<provider>` and `/health`).
pub const DEFAULT_PROXY_PORT: u16 = 4000;
/// The sidecar is only ever reached over loopback.
pub const LOOPBACK_HOST: &str = "127.0.0.1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ports {
    pub api: u16,
    pub proxy: u16,
}

/// A usable TCP port, or `default`. Rejects empty, non-numeric, zero and out-of-range values
/// (port 0 would mean "pick any", which the webview could not be told about).
pub fn parse_port(raw: Option<&str>, default: u16) -> u16 {
    raw.map(str::trim)
        .and_then(|s| s.parse::<u16>().ok())
        .filter(|p| *p != 0)
        .unwrap_or(default)
}

/// Same variables, same precedence as packages/proxy/src/server.ts:
/// `LLM_OBSERVER_PORT` then the legacy `DASHBOARD_PORT`; `LLM_OBSERVER_PROXY_PORT` then `PROXY_PORT`.
pub fn ports_from(get: impl Fn(&str) -> Option<String>) -> Ports {
    let first = |names: &[&str], default: u16| {
        for name in names {
            if let Some(v) = get(name).filter(|v| !v.trim().is_empty()) {
                return parse_port(Some(&v), default);
            }
        }
        default
    };
    Ports {
        api: first(&["LLM_OBSERVER_PORT", "DASHBOARD_PORT"], DEFAULT_API_PORT),
        proxy: first(&["LLM_OBSERVER_PROXY_PORT", "PROXY_PORT"], DEFAULT_PROXY_PORT),
    }
}

pub fn ports_from_env() -> Ports {
    ports_from(|name| std::env::var(name).ok())
}

pub fn api_base(api_port: u16) -> String {
    format!("http://{}:{}", LOOPBACK_HOST, api_port)
}

/// Script run in the webview before the page's own scripts.
pub fn init_script(api_port: u16) -> String {
    format!("window.__LLM_OBSERVER_API_BASE__ = {:?};", api_base(api_port))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let m: HashMap<String, String> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |k| m.get(k).cloned()
    }

    #[test]
    fn defaults_match_llm_observer_start() {
        assert_eq!(ports_from(env(&[])), Ports { api: 4001, proxy: 4000 });
    }

    #[test]
    fn honours_the_documented_variables() {
        let p = ports_from(env(&[("LLM_OBSERVER_PORT", "16002"), ("LLM_OBSERVER_PROXY_PORT", "16003")]));
        assert_eq!(p, Ports { api: 16002, proxy: 16003 });
    }

    #[test]
    fn legacy_names_work_but_lose_to_the_documented_ones() {
        let p = ports_from(env(&[("DASHBOARD_PORT", "5001"), ("PROXY_PORT", "5000")]));
        assert_eq!(p, Ports { api: 5001, proxy: 5000 });
        let p = ports_from(env(&[("DASHBOARD_PORT", "5001"), ("LLM_OBSERVER_PORT", "6001")]));
        assert_eq!(p.api, 6001);
    }

    #[test]
    fn garbage_falls_back_to_the_default() {
        for bad in ["", " ", "abc", "0", "65536", "-1", "4001.5", "http://x"] {
            assert_eq!(parse_port(Some(bad), 4001), 4001, "{bad:?}");
        }
        assert_eq!(parse_port(None, 4001), 4001);
        assert_eq!(parse_port(Some(" 4010 "), 4001), 4010);
        assert_eq!(parse_port(Some("65535"), 4001), 65535);
    }

    #[test]
    fn injects_an_absolute_loopback_url() {
        assert_eq!(api_base(16002), "http://127.0.0.1:16002");
        assert_eq!(init_script(4001), "window.__LLM_OBSERVER_API_BASE__ = \"http://127.0.0.1:4001\";");
    }
}
