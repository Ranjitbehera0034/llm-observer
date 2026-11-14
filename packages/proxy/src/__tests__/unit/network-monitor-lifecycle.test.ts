import dns from 'dns/promises';
import { getDb, getSetting } from '@llm-observer/database';
import { NetworkMonitor } from '../../services/networkMonitor';

jest.mock('dns/promises', () => ({ lookup: jest.fn() }));
jest.mock('@llm-observer/database', () => ({ getSetting: jest.fn(), getDb: jest.fn() }));

let monitor: NetworkMonitor;
let write: jest.Mock;
beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    monitor = new NetworkMonitor();
    write = jest.fn();
    (getSetting as jest.Mock).mockImplementation(key => key === 'network_monitor_enabled' ? 'true' : '5000');
    (getDb as jest.Mock).mockReturnValue({ exec: jest.fn(), prepare: jest.fn(() => ({ run: write })) });
    (dns.lookup as jest.Mock).mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
});
afterEach(() => { monitor.stop(); jest.restoreAllMocks(); jest.useRealTimers(); });

it('does not restart after being stopped during DNS resolution', async () => {
    (dns.lookup as jest.Mock).mockImplementation(() => new Promise(() => {}));
    const starting = monitor.start();
    await jest.advanceTimersByTimeAsync(0);
    monitor.stop();
    await jest.advanceTimersByTimeAsync(3000);
    await starting;
    expect(monitor.getStatus().running).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
});

it('starts within the DNS deadline when offline', async () => {
    (dns.lookup as jest.Mock).mockImplementation(() => new Promise(() => {}));
    const starting = monitor.start();
    await jest.advanceTimersByTimeAsync(3000);
    await starting;
    expect(monitor.getStatus()).toMatchObject({ running: true, knownIps: 0 });
    monitor.stop();
    expect(jest.getTimerCount()).toBe(0);
});

it('does not write or reschedule a slow scan after being stopped', async () => {
    const pendingScan = () => new Promise(resolve => setTimeout(() => resolve([
        { process: 'test-app', pid: 123, ip: '203.0.113.10', port: 443 }
    ]), 3000));
    jest.spyOn(monitor as any, 'scanMacOS').mockImplementation(pendingScan);
    jest.spyOn(monitor as any, 'scanLinux').mockImplementation(pendingScan);
    await monitor.start();
    await jest.advanceTimersByTimeAsync(5000);
    monitor.stop();
    await jest.advanceTimersByTimeAsync(3000);
    expect(write).not.toHaveBeenCalled();
    expect(monitor.getStatus().running).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
});

it('keeps monitoring off without resolving domains when disabled', async () => {
    (getSetting as jest.Mock).mockReturnValue('false');
    await monitor.start();
    expect(dns.lookup).not.toHaveBeenCalled();
    expect(monitor.getStatus().running).toBe(false);
});


it.each([
    ['1', 5000], ['3000000000', 60000], ['NaN', 15000], ['-1', 15000], ['0', 15000]
])('bounds configured scan interval %s to avoid a busy timer loop', async (configured, expected) => {
    (getSetting as jest.Mock).mockImplementation(key => key === 'network_monitor_enabled' ? 'true' : configured);
    const scan = jest.spyOn(monitor as any, 'scan').mockResolvedValue(undefined);
    await monitor.start();
    expect(monitor.getStatus().scanIntervalMs).toBe(expected);
    await jest.advanceTimersByTimeAsync(1000);
    expect(scan).not.toHaveBeenCalled();
});
