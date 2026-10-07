// update-notifier v7 is ESM-only and its bundled types are not resolvable under
// this package's CommonJS ("moduleResolution": "node") config. Declare just the
// surface updateNotice.ts uses.
declare module 'update-notifier' {
    interface Notifier {
        notify(options?: { defer?: boolean }): void;
    }
    export default function updateNotifier(options: { pkg: { name: string; version: string } }): Notifier;
}
