import { describe, expect, it } from 'vitest';
import type { McuBoardSpec, McuHost } from '../types';
import { Rp2040Runtime } from './Rp2040Runtime';
import { base64ToBytes, parseUf2 } from './uf2';
import uf2B64 from './fixtures/blink.uf2.b64?raw'; // base64 of fixtures/blink.uf2

/**
 * Gerçek arduino-cli (rp2040:rp2040 6.4.0 / Earle Philhower arduino-pico, rpipico) ile derlenmiş Blink UF2'si.
 * Kaynak: void setup(){pinMode(25,OUTPUT);} void loop(){digitalWrite(25,HIGH);delay(500);digitalWrite(25,LOW);delay(500);}
 * Not: gerçek bootrom yok; ROM yardımcıları romShim.ts ile taklit edilir.
 */
const pinMap: Record<number, string> = {};
for (let i = 0; i <= 28; i++) pinMap[i] = `GP${i}`;
const spec: McuBoardSpec = {
  family: 'rp2040', vcc: 3.3, intBits: 32, cpuHz: 133e6, adcBits: 10, adcVref: 3.3, pinMap, constants: {},
  pwmPins: [], pwmHz: 1000, adcPins: [26, 27, 28], inputOnly: [], rOutHigh: 50, rOutLow: 50, rPullup: 50000, imaxPin: 0.012,
  vInMargin: 0.3, supplies: [], gnd: [], notes: [],
};
const host: McuHost = { readVoltage: () => 0 };
const uf2 = base64ToBytes(uf2B64);

describe('UF2 ayrıştırma', () => {
  it('gerçek UF2 geçerli, flash 0x10000000 taban adresinde', () => {
    const r = parseUf2(uf2);
    expect(r.ok).toBe(true);
    expect(r.size).toBeGreaterThan(50_000);
    expect(r.image[0x100]).not.toBe(0xff);
  });
  it('bozuk girdiyi reddeder', () => {
    expect(parseUf2(new Uint8Array(100)).ok).toBe(false);
    expect(parseUf2(new Uint8Array(512)).ok).toBe(false);
    const rt = new Rp2040Runtime(spec);
    expect(rt.load('!!!').ok).toBe(false);
  });
});

describe('gerçek derlenmiş Pico UF2', () => {
  it('Blink: GP25 2.3 s simüle sürede ~1 Hz (500 ms/500 ms) yanıp söner', () => {
    const rt = new Rp2040Runtime(spec);
    expect(rt.loadBytes(uf2).ok).toBe(true);
    const edges: { t: number; high: boolean }[] = [];
    let last = rt.gpioLevel(25);
    for (let t = 0.001; t <= 2.3; t += 0.001) {
      rt.advance(t, host);
      expect(rt.halted()).toBeNull();
      const l = rt.gpioLevel(25);
      if (l !== last) edges.push({ t, high: l });
      last = l;
    }
    expect(edges.length).toBe(5);
    expect(edges.map((e) => e.high)).toEqual([true, false, true, false, true]);
    for (let i = 1; i < edges.length; i++) expect(edges[i].t - edges[i - 1].t).toBeGreaterThan(0.49);
    for (let i = 1; i < edges.length; i++) expect(edges[i].t - edges[i - 1].t).toBeLessThan(0.51);
    expect(rt.drives(2.3).get('GP25')).toEqual({ mode: 'out', high: true });
    expect(rt.gpio(2.3).find((g) => g.pin === 'GP25')?.mode).toBe('out');
    expect(rt.warnings().some((w) => w.includes('bootrom'))).toBe(true);
  });

  it('reset programı baştan başlatır', () => {
    const rt = new Rp2040Runtime(spec);
    rt.loadBytes(uf2);
    rt.advance(0.3, host);
    expect(rt.gpioLevel(25)).toBe(true);
    rt.reset();
    expect(rt.gpioLevel(25)).toBe(false);
    rt.advance(0.3, host);
    expect(rt.gpioLevel(25)).toBe(true);
  });
});
