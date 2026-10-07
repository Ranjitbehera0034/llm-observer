import path from 'path';

/**
 * Where `llm-observer start` records the PID of the server it spawns, and where
 * `llm-observer stop` looks for it. Shared so the two commands cannot drift.
 */
export function getPidPath(): string {
    return path.join(
        process.env.HOME || process.env.USERPROFILE || '',
        '.llm-observer',
        'observer.pid'
    );
}
