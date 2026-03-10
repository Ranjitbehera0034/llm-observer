# Tauri Signing Key Setup (GitHub Actions)

This is required for the GitHub Actions release workflow to work. Without these, `.dmg` and `.exe` installers will fail to build.

## Step 1: Generate the Key Pair

Run this on your local machine:

```bash
# Install Tauri CLI if not already installed
cargo install tauri-cli@^2

# Generate the signing keypair
cargo tauri signer generate -w ~/.tauri/llm-observer.key
```

This generates two files:
- `~/.tauri/llm-observer.key` — **private key** (keep secret)
- `~/.tauri/llm-observer.key.pub` — **public key** (safe to share)

## Step 2: Copy Key Values

```bash
# Copy private key content
cat ~/.tauri/llm-observer.key

# Copy public key content
cat ~/.tauri/llm-observer.key.pub
```

## Step 3: Add to GitHub Repository Secrets

Go to: `https://github.com/Ranjitbehera0034/llm-observer/settings/secrets/actions`

Add these secrets:

| Secret Name | Value |
|-------------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | Content of `~/.tauri/llm-observer.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password you entered during key generation (or leave blank) |

## Step 4: Add Public Key to tauri.conf.json

Open `packages/desktop/src-tauri/tauri.conf.json` and add the public key to the updater config:

```json
{
  "plugins": {
    "updater": {
      "endpoints": ["https://github.com/Ranjitbehera0034/llm-observer/releases/latest/download/latest.json"],
      "pubkey": "<paste your .pub key content here>"
    }
  }
}
```

## Step 5: Create Your First Release

```bash
# Tag a version to trigger the GitHub Actions release workflow
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions will build for all 3 platforms and create a GitHub Release automatically.

> **Keep your private key safe!** If lost, all users on old versions cannot update without reinstalling.
