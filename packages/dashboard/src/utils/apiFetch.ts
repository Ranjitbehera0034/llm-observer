// Bound requests so a stalled local service cannot leave loading states pending forever.
export const apiFetch: typeof fetch = (input, init = {}) => {
    return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(15000) });
};
