// Preloaded into the desktop sidecar with `node --require .../parent-watch.js server.js`.
//
// The sidecar is a child of the Tauri app. When the app quits normally Tauri's shell
// plugin kills it, but when the app is SIGTERMed, SIGKILLed, crashes or the session
// ends, nothing does, and the orphaned Node server keeps holding its ports (the next
// launch's sidecar then fails with "port already in use"). So: watch the parent.
//
// LLM_OBSERVER_PARENT_PID is set by src-tauri/src/lib.rs. Not set (npm CLI, Docker,
// tests) means this file does nothing. On loss of the parent we send ourselves SIGTERM
// so the server's normal graceful shutdown (flush queued requests, close the database)
// runs.

'use strict';

const parentPid = Number(process.env.LLM_OBSERVER_PARENT_PID);
const intervalMs = Number(process.env.LLM_OBSERVER_PARENT_WATCH_MS) || 2000;

function alive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        // EPERM means it exists but is not ours to signal: still alive.
        return err.code === 'EPERM';
    }
}

if (Number.isInteger(parentPid) && parentPid > 1 && parentPid !== process.pid) {
    const timer = setInterval(() => {
        if (!alive(parentPid)) {
            clearInterval(timer);
            console.error(`[sidecar] parent process ${parentPid} is gone; shutting down`);
            process.kill(process.pid, 'SIGTERM');
            // If the server has not exited after its own grace period, do not linger.
            setTimeout(() => process.exit(0), 8000).unref();
        }
    }, intervalMs);
    timer.unref();
}
