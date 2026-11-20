import { describe, expect, it } from 'vitest';
import { buildRequest, EMPTY_KEYS, hasKeys, safeUrl, searchOnline } from './parts';

describe('online parts client', () => {
  it('keys go in headers only, never in the URL', () => {
    const k = { nexarId: 'id1', nexarSecret: 'sec1', mouserKey: 'mk1' };
    const n = buildRequest('nexar', 'LM339', k);
    expect(n.url).toBe('/api/parts/search?provider=nexar&q=LM339&limit=10');
    expect(n.headers['x-nexar-client-secret']).toBe('sec1');
    const m = buildRequest('mouser', '1N4148', k);
    expect(m.url).not.toContain('mk1');
    expect(m.headers['x-mouser-api-key']).toBe('mk1');
  });
  it('missing key: error, no fetch', async () => {
    expect(hasKeys('nexar', EMPTY_KEYS)).toBe(false);
    await expect(searchOnline('mouser', 'x', EMPTY_KEYS)).rejects.toThrow(/gerekli/);
  });
  it('safeUrl allows http(s) only', () => {
    expect(safeUrl('https://a.b/c.pdf')).toBe('https://a.b/c.pdf');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
});
