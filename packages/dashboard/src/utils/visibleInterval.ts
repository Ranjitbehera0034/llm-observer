export function visibleInterval(callback: () => unknown, delay: number): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let running = false;
    const schedule = () => {
        if (!disposed && !document.hidden && !running) timer = setTimeout(tick, delay);
    };
    const tick = async () => {
        if (disposed || document.hidden || running) return;
        running = true;
        try { await callback(); } catch (error) { console.error('Refresh failed', error); }
        finally { running = false; schedule(); }
    };
    const onVisibility = () => {
        clearTimeout(timer);
        if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return () => { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
}
