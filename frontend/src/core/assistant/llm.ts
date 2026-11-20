import type { Circuit } from '../circuit/types';
import { formatSI } from '../units';
import { review } from './analysis';
import { buildContext, num, type Ctx } from './context';
import type { Answer, Block } from './types';

/** Optional LLM mode. Only used when the user has entered an API key and explicitly asks; the circuit summary below is exactly what is sent. */

export interface ChatMsg { role: 'user' | 'assistant'; content: string }

const MAX_CTX = 24000;

/** Compact, human-readable circuit description sent to the model as grounding (no secrets, no file paths). */
export function describeContext(ctx: Ctx, selection?: string): string {
  const L: string[] = [];
  L.push(`Proje: ${ctx.circuit.components.length} bileşen, ${ctx.circuit.wires.length} kablo, ${ctx.nets.netCount} düğüm (0 = GND). Ortam ${ctx.circuit.ambient ?? 25} °C.`);
  L.push('BİLEŞENLER (ref | tür | parametreler | simülasyon V/I/P):');
  for (const c of ctx.circuit.components) {
    const def = ctx.def(c);
    if (def.model === 'ground') continue;
    const params = def.params.filter((p) => p.type === 'number' && ['r', 'c', 'l', 'v', 'amp', 'freq', 'vz', 'i', 'bf', 'vth', 'k', 'pmax', 'vmax', 'imax', 'ifmax'].includes(p.key)).map((p) => `${p.key}=${formatSI(num(c, p.key), p.unit)}`).join(' ');
    const r = ctx.results?.[c.id];
    L.push(`- ${c.ref} | ${def.name}${def.mpn ? ` (${def.mpn})` : ''} | ${params} | ${r ? `V=${formatSI(r.v, 'V', 3)} I=${formatSI(r.i, 'A', 3)} P=${formatSI(r.p, 'W', 3)}` : 'çözüm yok'}${c.id === selection ? ' | SEÇİLİ' : ''}`);
  }
  L.push('DÜĞÜMLER:');
  ctx.nets.names.forEach((nm, i) => L.push(`- ${nm}: ${ctx.netPins(i).map((p) => `${p.comp.ref}.${p.pin}`).join(', ')}${ctx.results ? ` (${formatSI(ctx.netPins(i).length ? ctx.v(ctx.netPins(i)[0].comp, ctx.netPins(i)[0].pin) : 0, 'V', 3)})` : ''}`));
  if (ctx.dcError) L.push(`DC ÇÖZÜM HATASI: ${ctx.dcError}`);
  const f = review(ctx);
  if (f.length) { L.push('OTOMATİK KURAL TABANLI BULGULAR:'); f.slice(0, 15).forEach((x) => L.push(`- [${x.severity}] ${x.title}: ${x.detail}${x.fix ? ' Öneri: ' + x.fix : ''}`)); }
  return L.join('\n').slice(0, MAX_CTX);
}

export const SYSTEM_PROMPT = `Sen ElectroLab 3D sanal elektronik laboratuvarının mühendislik asistanısın. Kullanıcı Türkçe yazar; Türkçe cevap ver.
Kurallar:
- Aşağıdaki devre bağlamını ve çözücü sonuçlarını temel al; olmayan bağlantıyı veya değeri uydurma.
- Hesapları adım adım göster (formül, yerine konan sayılar, birimler, sonuç) ve kullandığın kaynakları/yasaları adlandır (Ohm, KCL/KVL, IPC-2221, datasheet alanı vb.).
- Datasheet değerlerini bilmiyorsan söyle; kütüphane değerleri doğrulanmamıştır. Belirsiz olan her şeyi açıkça belirt, kesin yanma/arıza süresi verme (risk ve belirsizlik ver).
- Simülasyon yaklaşık (genel modeller, ideal kaynaklar, tahmini ısıl direnç). Gerçek donanım önerilerinde güvenlik uyarısı ekle: şebeke gerilimi, büyük kondansatörler, piller (Li-ion termal kaçak), yüksek akım.
- Kısa ve somut ol; önce cevabı ver, sonra hesabı.`;

export function buildSystem(circuit: Circuit, selection?: string, offline?: Answer | null, includeCircuit = true): string {
  const parts = [SYSTEM_PROMPT];
  if (includeCircuit) parts.push('--- DEVRE BAĞLAMI ---', describeContext(buildContext(circuit), selection));
  if (offline) parts.push('--- ÇEVRİMDIŞI MOTORUN HESAPLADIĞI ÖN CEVAP (doğrula, genişlet, gerekirse düzelt) ---', blocksToText(offline.blocks).slice(0, 6000));
  return parts.join('\n');
}

export function blocksToText(blocks: Block[]): string {
  return blocks.map((b) => {
    switch (b.t) {
      case 'p': case 'warn': return b.text;
      case 'list': return b.items.map((x) => `- ${x}`).join('\n');
      case 'calc': return `${b.calc.title}:\n${b.calc.steps.join('\n')}\nSonuç: ${b.calc.result}`;
      case 'finding': return `[${b.f.severity}] ${b.f.title}: ${b.f.detail}${b.f.fix ? ' Öneri: ' + b.f.fix : ''}`;
      case 'code': return b.code;
      case 'table': return [b.head.join(' | '), ...b.rows.map((r) => r.join(' | '))].join('\n');
    }
  }).join('\n');
}

export interface LlmOptions { apiKey?: string; model?: string; includeCircuit?: boolean; selection?: string; offline?: Answer | null }

export async function askLlm(question: string, history: ChatMsg[], circuit: Circuit, o: LlmOptions = {}): Promise<{ text: string; model: string; usage?: { input_tokens: number; output_tokens: number } }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (o.apiKey) headers['x-api-key'] = o.apiKey;
  const messages: ChatMsg[] = [...history.slice(-8), { role: 'user', content: question }];
  while (messages.length && messages[0].role !== 'user') messages.shift();
  const r = await fetch('/api/ai/chat', { method: 'POST', headers, body: JSON.stringify({ model: o.model || undefined, system: buildSystem(circuit, o.selection, o.offline, o.includeCircuit !== false), messages, max_tokens: 1500 }) });
  if (!r.ok) {
    let detail = '';
    try { detail = (await r.json()).detail ?? ''; } catch { /* ignore */ }
    throw new Error(r.status === 503 ? String(detail || 'API anahtarı yok') : `Yapay zekâ isteği başarısız (${r.status}) ${typeof detail === 'string' ? detail : ''}`.trim());
  }
  return (await r.json()) as { text: string; model: string; usage?: { input_tokens: number; output_tokens: number } };
}

export async function aiServerStatus(): Promise<{ server_key: boolean; default_model: string } | null> {
  try { const r = await fetch('/api/ai/status'); return r.ok ? await r.json() : null; } catch { return null; }
}
