/**
 * Checks npm for a newer published version of this CLI and prints a short
 * heads-up if one exists, so a global-install user actually discovers new
 * releases instead of silently staying on an old version forever.
 *
 * update-notifier v7+ is ESM-only; dynamic import() is the documented way to
 * consume an ESM package from this package's CommonJS build output (same
 * pattern used for openid-client in packages/team-server). tsup leaves
 * dynamic import() calls for external dependencies untouched, so this
 * resolves against the real installed package at runtime.
 *
 * Fully opt-out-able and safe by the library's own defaults: disabled via
 * NO_UPDATE_NOTIFIER (any value) or `--no-update-notifier`, auto-skipped in
 * CI and non-interactive/piped output, and the only network call it ever
 * makes is a background read of the current version number from the public
 * npm registry — no other data leaves the machine.
 */
export function checkForUpdate(name: string, version: string): void {
    import('update-notifier')
        .then(({ default: updateNotifier }) => {
            updateNotifier({ pkg: { name, version } }).notify({ defer: false });
        })
        .catch(() => {
            // A blocked registry, read-only filesystem, etc. must never affect
            // the actual command the user ran.
        });
}
