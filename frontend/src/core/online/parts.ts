/** Client for /api/parts (official-API proxy). Only the query + provider are sent; keys go in headers, per request. */

export type ProviderId = 'nexar' | 'mouser';
export interface PriceBreak { qty: number; price: number; currency: string }
export interface Offer { distributor: string; sku?: string | null; stock?: number | null; price_breaks: PriceBreak[]; url?: string | null }
export interface OnlinePart { provider: ProviderId; mpn: string; manufacturer: string; description: string; datasheet_urls: string[]; offers: Offer[]; fetched_at: string }
export interface OnlineSearch { provider: ProviderId; query: string; results: OnlinePart[]; notes: string[] }
export interface ProviderInfo { id: string; name: string; status: 'available' | 'planned' | 'unsupported'; note: string }

export const LS_KEYS = 'electrolab.onlineKeys';
export interface Keys { nexarId: string; nexarSecret: string; mouserKey: string }
export const EMPTY_KEYS: Keys = { nexarId: '', nexarSecret: '', mouserKey: '' };

export function loadKeys(): Keys {
  try { return { ...EMPTY_KEYS, ...(JSON.parse(localStorage.getItem(LS_KEYS) ?? '{}') as Partial<Keys>) }; } catch { return EMPTY_KEYS; }
}
export function saveKeys(k: Keys): void { try { localStorage.setItem(LS_KEYS, JSON.stringify(k)); } catch { /* ignore */ } }
export function clearKeys(): void { try { localStorage.removeItem(LS_KEYS); } catch { /* ignore */ } }

/** True when the provider's required key fields are filled. */
export function hasKeys(p: ProviderId, k: Keys): boolean {
  return p === 'nexar' ? !!(k.nexarId.trim() && k.nexarSecret.trim()) : !!k.mouserKey.trim();
}

export function buildRequest(provider: ProviderId, q: string, k: Keys): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  if (provider === 'nexar') { headers['x-nexar-client-id'] = k.nexarId.trim(); headers['x-nexar-client-secret'] = k.nexarSecret.trim(); }
  else headers['x-mouser-api-key'] = k.mouserKey.trim();
  return { url: `/api/parts/search?${new URLSearchParams({ provider, q: q.trim(), limit: '10' }).toString()}`, headers };
}

export async function providerList(): Promise<ProviderInfo[] | null> {
  try { const r = await fetch('/api/parts/providers'); return r.ok ? ((await r.json()) as ProviderInfo[]) : null; } catch { return null; }
}

export async function searchOnline(provider: ProviderId, q: string, k: Keys): Promise<OnlineSearch> {
  if (!hasKeys(provider, k)) throw new Error('API anahtarı gerekli (EKSİK)');
  const { url, headers } = buildRequest(provider, q, k);
  let r: Response;
  try { r = await fetch(url, { headers }); } catch { throw new Error('Yerel sunucuya ulaşılamadı (backend çalışıyor mu?)'); }
  if (!r.ok) {
    let detail = '';
    try { detail = String((await r.json()).detail ?? ''); } catch { /* ignore */ }
    throw new Error(detail || `İstek başarısız (${r.status})`);
  }
  return (await r.json()) as OnlineSearch;
}

/** Only http(s) links are ever rendered as anchors. */
export const safeUrl = (u: string | null | undefined): string | null => (u && /^https?:\/\//i.test(u) ? u : null);
