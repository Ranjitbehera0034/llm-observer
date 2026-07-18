# Signing desktop releases

`release.yml` (triggered by pushing a `v*` tag) builds the Tauri desktop app for
macOS/Linux/Windows via `tauri-apps/tauri-action` and already forwards
`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from repo
secrets. What's missing before a real signed release can ship is the actual
keypair — this repo can't generate one on your behalf, since the private half
must never be seen by anyone but you.

## One-time setup

1. Generate a keypair (do this locally, not in CI):

   ```bash
   npx @tauri-apps/cli signer generate -w ~/llm-observer-signing-key.key
   ```

   This prints a public key and writes the private key to the path you gave it.
   **Never commit the private key file.**

2. Put the **public** key into
   [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json), replacing the
   `plugins.updater.pubkey` placeholder (`REPLACE_WITH_REAL_UPDATER_PUBKEY_SEE_SIGNING_MD`)
   with the string `tauri signer generate` printed. This file is safe to
   commit — it's the public half.

3. Store the **private** key and its password as repo secrets (Settings →
   Secrets and variables → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` — contents of the `.key` file
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you set when generating it

4. Delete the local `.key` file once it's stored as a secret, or keep it
   somewhere outside the repo (a password manager) — it's the only way to
   produce a signature future app updates will verify against the pubkey
   from step 2. Losing it means users on an old version can never
   auto-update past it.

## Why this matters

`tauri-plugin-updater` is compiled into the app
([`src-tauri/src/lib.rs`](src-tauri/src/lib.rs)) and configured to check
`plugins.updater.endpoints` in `tauri.conf.json` for a signed `latest.json`.
Until the placeholder pubkey above is replaced with a real one matching a
real private key held in CI secrets, `tauri-action` has nothing valid to sign
release artifacts with — release binaries build fine, but the in-app
auto-updater cannot verify them. This is intentionally a hard placeholder
(not a working default) so that gap can't be missed silently.

## Verifying a downloaded binary

Once signing is set up, `tauri-action` attaches a `.sig` file next to each
bundle (e.g. `LLM-Observer_1.14.0_x64.dmg.sig`) plus a `latest.json` manifest
— this is what the in-app updater checks automatically; there's no separate
plain `.sha256` file for desktop binaries from Tauri itself. The `.sig` is a
[minisign](https://jedisct1.github.io/minisign/) signature (confirmed by
generating a test keypair with `tauri signer generate` — its own public-key
file is headed `minisign public key`), so a downloaded bundle can be verified
by hand with the `minisign` CLI and the pubkey from `tauri.conf.json`:

```bash
minisign -V -P <pubkey from tauri.conf.json> -m LLM-Observer_1.14.0_x64.dmg -x LLM-Observer_1.14.0_x64.dmg.sig
```

(The npm package gets a plain `CHECKSUMS.txt` instead — see `publish.yml`'s
`sha256sum` step — since it isn't updater-signed.)
