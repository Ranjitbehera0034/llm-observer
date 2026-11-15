import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { visibleInterval } from '../../packages/dashboard/src/utils/visibleInterval';
let doc: EventTarget & { hidden: boolean };
beforeEach(() => { vi.useFakeTimers(); doc = Object.assign(new EventTarget(), { hidden: false }); vi.stubGlobal('document', doc); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('stops hidden-window polling and refreshes once on return', async () => {
    const callback = vi.fn(); const stop = visibleInterval(callback, 1000);
    await vi.advanceTimersByTimeAsync(1000); expect(callback).toHaveBeenCalledTimes(1);
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60000); expect(callback).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0); expect(callback).toHaveBeenCalledTimes(2);
    stop(); await vi.advanceTimersByTimeAsync(60000); expect(callback).toHaveBeenCalledTimes(2);
});
it('does not overlap a slow refresh and cleans up in-flight work', async () => {
    let resolve!: () => void;
    const callback = vi.fn(() => new Promise<void>(r => { resolve = r; }));
    const stop = visibleInterval(callback, 1000);
    await vi.advanceTimersByTimeAsync(10000); expect(callback).toHaveBeenCalledTimes(1);
    stop(); resolve(); await vi.advanceTimersByTimeAsync(10000);
    expect(callback).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
