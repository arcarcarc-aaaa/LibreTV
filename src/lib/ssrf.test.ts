import dns from 'node:dns/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isBlockedByDNS, isPrivateIP, isValidProxyUrl } from './ssrf';

describe('DNS 检查在 Workers 中仍然保护私有地址', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('没有 AAAA 时，仍拦截 A 记录中的私有地址', async () => {
    vi.spyOn(dns, 'resolve4').mockResolvedValue(['192.168.1.1']);
    vi.spyOn(dns, 'resolve6').mockRejectedValue(new Error('ENODATA'));
    expect(await isBlockedByDNS('https://private.example/test')).toBe(true);
  });

  it('A 公开但 AAAA 私有时仍拦截', async () => {
    vi.spyOn(dns, 'resolve4').mockResolvedValue(['8.8.8.8']);
    vi.spyOn(dns, 'resolve6').mockResolvedValue(['fd00::1']);
    expect(await isBlockedByDNS('https://mixed.example/test')).toBe(true);
  });

  it('仅有公开 A 记录时正常放行', async () => {
    vi.spyOn(dns, 'resolve4').mockResolvedValue(['8.8.8.8']);
    vi.spyOn(dns, 'resolve6').mockRejectedValue(new Error('ENODATA'));
    expect(await isBlockedByDNS('https://public.example/test')).toBe(false);
  });

  it('两种地址族均无法验证时拒绝，避免静默跳过防护', async () => {
    vi.spyOn(dns, 'resolve4').mockRejectedValue(new Error('ENOTFOUND'));
    vi.spyOn(dns, 'resolve6').mockRejectedValue(new Error('ENOTFOUND'));
    expect(await isBlockedByDNS('https://unknown.example/test')).toBe(true);
  });

  it('DNS 长时间无响应时在三秒内拒绝，不让请求一直等待', async () => {
    vi.useFakeTimers();
    vi.spyOn(dns, 'resolve4').mockImplementation(() => new Promise(() => {}));
    vi.spyOn(dns, 'resolve6').mockImplementation(() => new Promise(() => {}));
    const result = isBlockedByDNS('https://slow.example/test');
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBe(true);
  });
});

describe('isPrivateIP', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['192.168.1.1', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['::1', true],
    ['fe80::1', true],
    ['fd00::1', true],
    ['8.8.8.8', false],
    ['1.2.3.4', false],
    // URL.hostname 对 IPv6 会带方括号
    ['[::1]', true],
    ['[fe80::1]', true],
    ['[fd00::1]', true],
    ['[fc00::1]', true],
    // IPv4-mapped IPv6：十六进制形式与点分形式
    ['[::ffff:c0a8:164]', true], // ::ffff:192.168.1.100
    ['::ffff:192.168.1.100', true],
    ['[::ffff:7f00:1]', true], // ::ffff:127.0.0.1
    ['::ffff:127.0.0.1', true],
    ['[::ffff:a9fe:a9fe]', true], // ::ffff:169.254.169.254
    ['[::ffff:a00:1]', true], // ::ffff:10.0.0.1
    ['[::ffff:808:808]', false], // ::ffff:8.8.8.8 公网
    ['::ffff:8.8.8.8', false],
    ['[::ffff:c0a8:164', true], // 单边括号（异常输入）仍要拦
    ['[2606:4700::1111]', false], // 公网 IPv6 不应被误杀
  ])('%s → %s', (ip, expected) => {
    expect(isPrivateIP(ip)).toBe(expected);
  });
});

describe('isValidProxyUrl', () => {
  it('放行公网 http(s)', () => {
    expect(isValidProxyUrl('https://cdn.example.com/a.m3u8')).toBe(true);
    expect(isValidProxyUrl('http://1.2.3.4/x.ts')).toBe(true);
  });

  it('拦截内网与保留地址', () => {
    expect(isValidProxyUrl('http://localhost/x')).toBe(false);
    expect(isValidProxyUrl('http://127.0.0.1/x')).toBe(false);
    expect(isValidProxyUrl('http://192.168.1.1/x')).toBe(false);
    expect(isValidProxyUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
  });

  it('拦截带方括号的 IPv6 与 IPv4-mapped 写法', () => {
    expect(isValidProxyUrl('http://[::1]:8080/x')).toBe(false);
    expect(isValidProxyUrl('http://[::ffff:192.168.1.100]:8080/list.m3u')).toBe(false);
    expect(isValidProxyUrl('http://[::ffff:127.0.0.1]/x')).toBe(false);
    expect(isValidProxyUrl('http://[fe80::1]/x')).toBe(false);
    expect(isValidProxyUrl('http://[fd00::1]/x')).toBe(false);
  });

  it('不误杀公网 IPv6', () => {
    expect(isValidProxyUrl('http://[2606:4700::1111]/x')).toBe(true);
  });

  it('拦截非 http 协议', () => {
    expect(isValidProxyUrl('file:///etc/passwd')).toBe(false);
    expect(isValidProxyUrl('ftp://x.com/a')).toBe(false);
    expect(isValidProxyUrl('not a url')).toBe(false);
  });
});
