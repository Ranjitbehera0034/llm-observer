/** Poll `check` until it returns truthy or `timeoutMs` passes. Returns the elapsed milliseconds. */
export const waitFor = async (check: () => unknown, timeoutMs: number, stepMs = 50): Promise<number> => {
    const start = Date.now();
    for (;;) {
        if (await check()) return Date.now() - start;
        if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
        await new Promise(r => setTimeout(r, stepMs));
    }
};

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
