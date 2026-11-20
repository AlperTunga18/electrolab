import { describe, expect, it } from 'vitest';
import { LESSONS } from './content';
import { EvalCtx } from './engine';
import type { Fault } from '../core/circuit/types';

/**
 * Ders "arıza deneyi" metinleri: how'daki enjeksiyonu uygula, çöz; symptom'daki her
 * "sayı + birim" (A, mA, V, W, mW) sağlıklı veya arızalı çözümde bir büyüklükle eşleşmeli.
 * Ω ve diğer birimler, ve enjeksiyonu ayrıştırılamayan satırlar atlanır (sayılır).
 */
const UNIT: Record<string, number> = { A: 1, mA: 1e-3, 'µA': 1e-6, V: 1, mV: 1e-3, W: 1, mW: 1e-3 };

function parseFault(how: string): { ref: string; fault: Fault } | null {
  const m = how.match(/([A-Z]+\d+)[’']?(?:yi|yı|yu|yü|i|ı|u|ü|e|a|nin|nın)?\s+seçin/);
  if (!m) return null;
  if (/Açık devre/.test(how)) return { ref: m[1], fault: { kind: 'open' } };
  if (/Kısa devre/.test(how)) return { ref: m[1], fault: { kind: 'short' } };
  const d = how.match(/Değer kayması[^→]*→\s*(−|-)?(\d+(?:[.,]\d+)?)/);
  if (d) return { ref: m[1], fault: { kind: 'drift', amount: (d[1] ? -1 : 1) * Number(d[2].replace(',', '.')) } };
  return null;
}

function quantities(ctx: EvalCtx): number[] {
  const { sim, results } = ctx.dc();
  const out: number[] = [];
  for (const r of Object.values(results)) out.push(Math.abs(r.v), Math.abs(r.i), Math.abs(r.p));
  for (let n = 0; n < 40; n++) { try { out.push(Math.abs(sim.nodeVoltage(n))); } catch { break; } }
  return out;
}

describe('lesson fault prose vs solver', () => {
  let checked = 0, skipped = 0;
  for (const l of LESSONS) {
    for (const f of l.faults) {
      const pf = parseFault(f.how);
      it(`${l.id}: ${f.title}`, () => {
        if (!pf) { skipped++; return; }
        const c = l.build();
        const comp = c.components.find((x) => x.ref === pf.ref);
        if (!comp) { skipped++; return; }
        const healthy = quantities(new EvalCtx(c));
        const bad = quantities(new EvalCtx(c, { [comp.id]: pf.fault }));
        const pool = [...healthy, ...bad];
        if (/tepe|genlik|rms|RMS|tepeden/.test(f.symptom)) { skipped++; return; } // AC/geçici büyüklükler DC çözümde yok
        const re = /(\d+(?:[.,]\d+)?)\s*(mA|µA|A|mV|V|mW|W)(?![a-zA-Zµ])/g;
        const misses: string[] = [];
        for (const m of f.symptom.matchAll(re)) {
          const val = Number(m[1].replace(',', '.')) * UNIT[m[2]];
          if (val === 0) continue;
          const ok = pool.some((q) => Math.abs(q - val) <= 0.04 * val + 1e-9);
          if (!ok) misses.push(`${m[0]} (=${val})`);
        }
        checked++;
        expect(misses, `${l.id} "${f.title}" metindeki sayılar çözücüde bulunamadı`).toEqual([]);
      });
    }
  }
  it('summary', () => { console.log(`fault prose: checked=${checked} skipped=${skipped}`); });
});
