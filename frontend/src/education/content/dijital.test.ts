import { describe, expect, it } from 'vitest';
import { LiveRunner, type LiveSnapshot } from '../../core/sim/runner';
import type { Circuit, ParamMap } from '../../core/circuit/types';
import { build02, build03, build04, build05, build06, build07, build08 } from './dijital';

/** Drives the real LiveRunner with a fake animation clock (same approach as core/mcu/mcu.e2e.test.ts). */
function harness(circuit: Circuit, speed: number) {
  const g = globalThis as unknown as { requestAnimationFrame: (f: (t: number) => void) => number; cancelAnimationFrame: (n: number) => void };
  const raf: { cb: ((t: number) => void) | null } = { cb: null };
  g.requestAnimationFrame = (f) => { raf.cb = f; return 1; };
  g.cancelAnimationFrame = () => { raf.cb = null; };
  const snaps: LiveSnapshot[] = [];
  const serial: string[] = [];
  const reports: unknown[] = [];
  const run = new LiveRunner((s) => snaps.push(s), (e) => { throw e; }, () => {}, (r) => reports.push(r), {
    serial: (_c, t) => serial.push(t), log: () => {},
  });
  run.speed = speed; run.damageEnabled = true;
  run.start(circuit);
  let now = performance.now();
  const frames = (seconds: number, each?: () => void) => { for (let t = 0; t < seconds; t += 0.016) { now += 16; raf.cb?.(now); each?.(); } };
  return { run, snaps, serial, reports, frames, last: () => snaps[snaps.length - 1] };
}

const setParam = (c: Circuit, id: string, key: string, val: ParamMap[string]): Circuit => ({
  ...c, components: c.components.map((x) => (x.id === id ? { ...x, params: { ...x.params, [key]: val } } : x)),
});

describe('dijital-02: LED akım sınırı', () => {
  it('D13 500 ms aralıkla yanıp söner, LED akımı 8-16 mA', () => {
    const h = harness(build02(), 1);
    const iLed: number[] = [];
    h.frames(2.3, () => { const s = h.last(); if (s) iLed.push(s.comps.D1.i); });
    expect(iLed.filter((i) => i > 0.008).length).toBeGreaterThan(10);
    expect(iLed.filter((i) => Math.abs(i) < 1e-4).length).toBeGreaterThan(10);
    expect(Math.max(...iLed)).toBeLessThan(0.016);
    expect(Math.max(...iLed)).toBeGreaterThan(0.010);
    expect(h.serial.join('')).toContain('D13 = HIGH');
    h.run.stop();
  });
});

describe('dijital-03: buton ile LED aç/kapat (INPUT_PULLUP, active-low)', () => {
  it('her basışta LED durumu değişir', () => {
    const c = build03();
    const h = harness(c, 1);
    h.frames(0.3);
    expect(h.last().comps.D1.i).toBeLessThan(1e-4);
    expect(h.last().comps.U1.vals['v_D2']).toBeGreaterThan(4.5);
    h.run.update(setParam(c, 'SW1', 'closed', true));
    h.frames(0.3);
    expect(h.last().comps.U1.vals['v_D2']).toBeLessThan(0.3);
    expect(h.last().comps.D1.i).toBeGreaterThan(0.008);
    h.run.update(c); h.frames(0.3);                                  // bırak: LED yanık kalır
    expect(h.last().comps.D1.i).toBeGreaterThan(0.008);
    h.run.update(setParam(c, 'SW1', 'closed', true)); h.frames(0.3); // ikinci basış: söner
    expect(h.last().comps.D1.i).toBeLessThan(1e-4);
    const text = h.serial.join('');
    expect(text).toContain('LED ACIK');
    expect(text).toContain('LED KAPALI');
    h.run.stop();
  });
});

describe('dijital-04: ADC', () => {
  it('A0 ≈ 307 ve A1 ≈ 327 okunur', () => {
    const h = harness(build04(), 1);
    h.frames(1.2);
    const m = [...h.serial.join('').matchAll(/A0 ADC=(\d+) V=([\d.]+)\s+A1 ADC=(\d+) V=([\d.]+)/g)].pop()!;
    expect(Math.abs(Number(m[1]) - 307)).toBeLessThanOrEqual(2);
    expect(Math.abs(Number(m[3]) - 327)).toBeLessThanOrEqual(2);
    expect(Math.abs(Number(m[2]) - 1.5)).toBeLessThan(0.02);
    expect(Math.abs(Number(m[4]) - 1.6)).toBeLessThan(0.02);
    h.run.stop();
  });
});

describe('dijital-05: PWM', () => {
  it('D9 PWM duty ≈ %30 ve seri çıktı ADC=307 PWM=76', () => {
    const h = harness(build05(), 0.02);
    h.frames(1.5);
    const m = [...h.serial.join('').matchAll(/ADC=(\d+) PWM=(\d+)/g)].pop()!;
    expect(Math.abs(Number(m[1]) - 307)).toBeLessThanOrEqual(2);
    expect(Math.abs(Number(m[2]) - 76)).toBeLessThanOrEqual(1);
    const g = h.last().gpio.U1.find((x) => x.pin === 'D9')!;
    expect(g.mode).toBe('pwm');
    expect(g.duty!).toBeGreaterThan(0.28); expect(g.duty!).toBeLessThan(0.32);
    h.run.stop();
  });
});

describe('dijital-06: ESP32 GPIO -> MOSFET', () => {
  it('yük 1 s açık / 1 s kapalı; gate akımı < 0.5 mA', () => {
    const h = harness(build06(), 1);
    const rows: [number, number, number][] = [];
    h.frames(2.4, () => { const s = h.last(); if (s) rows.push([s.t, s.comps.RL.i, s.comps.R1.i]); });
    const at = (t: number) => rows.reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a));
    expect(at(0.5)[1]).toBeGreaterThan(0.9);
    expect(at(1.5)[1]).toBeLessThan(1e-3);
    expect(Math.max(...rows.map((r) => Math.abs(r[2])))).toBeLessThan(5e-4);   // yalnızca pull-down akımı ≈ 0.33 mA
    h.run.stop();
  });
});

describe('dijital-07: seviye bölücü', () => {
  it('bölücü ile pin hasar görmez ve HIGH okur', () => {
    const h = harness(build07(), 1);
    h.frames(1.2);
    expect(h.reports.length).toBe(0);
    expect(h.last().deadPins.U1 ?? []).not.toContain('D4');
    expect(h.serial.join('')).toContain('GPIO4 = 1');
    h.run.stop();
  });
  it('bölücü olmazsa (R2 açık) pin aşırı gerilimle bozulur', () => {
    const c = build07();
    const bad = { ...c, faults: { R2: { kind: 'open' as const } } };
    const h = harness(bad, 1);
    h.frames(1.2);
    expect(h.last().deadPins.U1).toContain('D4');
    h.run.stop();
  });
});

describe('dijital-08: millis ile bloklamayan blink', () => {
  it('iki LED farklı hızda toggle olur, buton olayı yakalanır', () => {
    const c = build08();
    const h = harness(c, 1);
    let t1 = 0, t2 = 0, p1 = false, p2 = false;
    const sample = () => {
      const s = h.last(); if (!s) return;
      const a = s.comps.D1.i > 0.004, b = s.comps.D2.i > 0.004;
      if (a !== p1) { t1++; p1 = a; }
      if (b !== p2) { t2++; p2 = b; }
    };
    h.frames(2.1, sample);
    expect(t1).toBeGreaterThanOrEqual(3); expect(t1).toBeLessThanOrEqual(6);      // ~4 geçiş (500 ms)
    expect(t2).toBeGreaterThanOrEqual(11); expect(t2).toBeLessThanOrEqual(16);    // ~14 geçiş (150 ms)
    h.run.update(setParam(c, 'SW1', 'closed', true));
    h.frames(0.3, sample);
    expect(h.serial.join('')).toContain('buton basildi #1');
    h.run.stop();
  });
});
