import { describe, expect, it } from 'vitest';
import type { McuBoardSpec, McuHost } from '../types';
import { AvrRuntime } from './AvrRuntime';
import { parseIntelHex } from './hex';

const pinMap: Record<number, string> = {};
for (let i = 0; i <= 13; i++) pinMap[i] = `D${i}`;
for (let i = 0; i < 6; i++) pinMap[14 + i] = `A${i}`;

const spec: McuBoardSpec = {
  family: 'avr',
  vcc: 5,
  intBits: 16,
  cpuHz: 16_000_000,
  adcBits: 10,
  adcVref: 5,
  pinMap,
  constants: {},
  pwmPins: [3, 5, 6, 9, 10, 11],
  pwmHz: 490,
  adcPins: [14, 15, 16, 17, 18, 19],
  inputOnly: [],
  rOutHigh: 25,
  rOutLow: 25,
  rPullup: 30000,
  imaxPin: 0.04,
  vInMargin: 0.5,
  supplies: [],
  gnd: [],
  notes: [],
};

/** Intel HEX from 16-bit words (little-endian bytes) */
function hexOf(words: number[]): string {
  const bytes: number[] = [];
  for (const w of words) bytes.push(w & 0xff, (w >> 8) & 0xff);
  const rec = (addr: number, type: number, data: number[]) => {
    const body = [data.length, (addr >> 8) & 0xff, addr & 0xff, type, ...data];
    const sum = body.reduce((a, b) => (a + b) & 0xff, 0);
    return ':' + [...body, (-sum) & 0xff].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  };
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) lines.push(rec(i, 0, bytes.slice(i, i + 16)));
  lines.push(rec(0, 1, []));
  return lines.join('\n') + '\n';
}

const hostOf = (v: Record<string, number>): McuHost => ({ readVoltage: (id) => v[id] ?? 0 });

const SBI_DDRB5 = 0x9a25;
const SBI_PORTB5 = 0x9a2d;
const CBI_PORTB5 = 0x982d;
const BLINK = [SBI_DDRB5, SBI_PORTB5, CBI_PORTB5, 0xcffd];

// copy D2 -> D13: sbic PIND,2 / sbi PORTB,5 / sbis PIND,2 / cbi PORTB,5 / rjmp loop
const COPY = [SBI_DDRB5, 0x994a, SBI_PORTB5, 0x9b4a, CBI_PORTB5, 0xcffb];

// ldi r16,8 ; sts UCSR0B,r16 ; ldi r17,'H' ; sts UDR0,r17 ; rjmp .-1
const SERIAL = [0xe008, 0x9300, 0x00c1, 0xe418, 0x9310, 0x00c6, 0xcfff];

describe('AvrRuntime', () => {
  it('rejects malformed hex with Turkish diagnostics', () => {
    const rt = new AvrRuntime(spec);
    const bad = rt.load(':10000000ZZ\n:020000000000FF\n');
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics.length).toBeGreaterThanOrEqual(2);
    expect(bad.diagnostics[0].line).toBe(1);
    expect(bad.diagnostics[0].message).toMatch(/HEX/);
    expect(bad.diagnostics.find((d) => d.line === 2)?.message).toMatch(/Sağlama/);
    expect(parseIntelHex('abc').ok).toBe(false);
    expect(parseIntelHex('').ok).toBe(false);
    expect(parseIntelHex(hexOf(BLINK)).ok).toBe(true);
  });

  it('blink: D13 becomes output and toggles', () => {
    const rt = new AvrRuntime(spec);
    expect(rt.load(hexOf(BLINK)).ok).toBe(true);
    const host = hostOf({});
    let t = 0;
    const seen = new Set<boolean>();
    for (let i = 0; i < 40; i++) {
      t += 1e-6;
      rt.advance(t, host);
      const d = rt.drives(t).get('D13')!;
      expect(d.mode).toBe('out');
      seen.add(d.high);
    }
    expect(seen.has(true)).toBe(true);
    expect(seen.has(false)).toBe(true);
    expect(rt.drives(t).get('D12')!.mode).toBe('in');
    const g = rt.gpio(t).find((x) => x.num === 13)!;
    expect(g.pin).toBe('D13');
    expect(g.mode).toBe('pwm'); // 1:2-ish duty square wave is indistinguishable from PWM
    expect(g.duty!).toBeGreaterThan(0.2);
    expect(g.duty!).toBeLessThan(0.8);
    expect(rt.gpio(t)).toHaveLength(20);
    expect(rt.halted()).toBeNull();
    expect(rt.warnings()).toEqual([]);
  });

  it('copies input D2 to output D13 with hysteresis', () => {
    const rt = new AvrRuntime(spec);
    expect(rt.load(hexOf(COPY)).ok).toBe(true);
    const v: Record<string, number> = { D2: 5 };
    const host = hostOf(v);
    let t = 0;
    const step = (volts: number) => {
      v.D2 = volts;
      t += 20e-6;
      rt.advance(t, host);
      return rt.drives(t).get('D13')!.high;
    };
    expect(step(5)).toBe(true);
    expect(step(0)).toBe(false);
    expect(step(4)).toBe(true); // >= 0.6*vcc
    expect(step(2)).toBe(true); // between 0.3 and 0.6: keeps previous (high)
    expect(step(0.5)).toBe(false); // <= 0.3*vcc
    expect(step(2)).toBe(false); // still in dead band: keeps low
    expect(rt.drives(t).get('D2')!.mode).toBe('in');
  });

  it('USART0 TX reaches onSerial', () => {
    const rt = new AvrRuntime(spec);
    let got = '';
    rt.onSerial = (s) => (got += s);
    expect(rt.load(hexOf(SERIAL)).ok).toBe(true);
    rt.advance(100e-6, hostOf({}));
    expect(got).toBe('H');
  });

  it('serialWrite feeds the USART receive path', () => {
    const rt = new AvrRuntime(spec);
    expect(rt.load(hexOf([0xcfff])).ok).toBe(true);
    const priv = rt as unknown as { cpu: { data: Uint8Array }; usart: { rxEnable: boolean } };
    priv.cpu.data[0xc1] = 0x10; // RXEN0 set directly (no firmware needed for this path test)
    rt.serialWrite('A');
    rt.advance(2e-3, hostOf({}));
    expect(priv.cpu.data[0xc0] & 0x80).toBe(0x80); // RXC0
    expect((priv.cpu as unknown as { readData(a: number): number }).readData(0xc6)).toBe(0x41); // UDR0 = 'A'
  });

  it('erased flash wraps like real hardware (no halt); reset restarts program', () => {
    const rt = new AvrRuntime(spec);
    expect(rt.load(hexOf(BLINK)).ok).toBe(true);
    rt.advance(1e-4, hostOf({}));
    expect(rt.drives(1e-4).get('D13')!.mode).toBe('out');
    rt.reset();
    expect(rt.halted()).toBeNull();
    expect(rt.drives(0).get('D13')!.mode).toBe('in'); // DDR cleared again
  });

  it('caps work per advance call', () => {
    const rt = new AvrRuntime(spec);
    rt.load(hexOf(BLINK));
    const t0 = Date.now();
    rt.advance(10, hostOf({})); // 160M cycles requested
    expect(Date.now() - t0).toBeLessThan(10000);
    expect(rt.warnings().some((w) => /gerisinde/.test(w))).toBe(true);
  });
});
