import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

it('Workers 模块加载期间无需启动定时器，限流窗口过后可重新登录', async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-21T00:00:00Z'));
  vi.stubGlobal('setInterval', () => {
    throw new Error('Timers are unavailable outside request context');
  });
  const { checkRateLimit } = await import('./auth');
  for (let i = 0; i < 10; i++) expect(checkRateLimit('worker-test')).toBe(true);
  expect(checkRateLimit('worker-test')).toBe(false);
  vi.setSystemTime(new Date('2026-10-21T00:11:00Z'));
  expect(checkRateLimit('worker-test')).toBe(true);
});
