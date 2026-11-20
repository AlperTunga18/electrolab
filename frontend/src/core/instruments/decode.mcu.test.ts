import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import type { Circuit } from '../circuit/types';
import { LiveRunner, type LiveSnapshot } from '../sim/runner';
import { decodeUart, toTrace } from './decode';

/** Same fake-animation-clock approach as core/mcu/mcu.e2e.test.ts */
function harness(circuit: Circuit, speed: number) {
  const g = globalThis as unknown as { requestAnimationFrame: (f: (t: number) => void) => number; cancelAnimationFrame: (n: number) => void };
  const raf: { cb: ((t: number) => void) | null } = { cb: null };
  g.requestAnimationFrame = (f) => { raf.cb = f; return 1; };
  g.cancelAnimationFrame = () => { raf.cb = null; };
  const snaps: LiveSnapshot[] = [];
  const run = new LiveRunner((s) => snaps.push(s), (e) => { throw e; }, () => {}, () => {}, { serial: () => {}, log: () => {} });
  run.speed = speed; run.damageEnabled = false;
  run.start(circuit);
  let now = performance.now();
  const frames = (seconds: number) => { for (let t = 0; t < seconds; t += 0.016) { now += 16; raf.cb?.(now); } };
  return { run, frames, last: () => snaps[snaps.length - 1] };
}

const SKETCH = `
void sendByte(int b) {
  digitalWrite(13, LOW);
  delayMicroseconds(104);
  for (int i = 0; i < 8; i++) {
    digitalWrite(13, (b >> i) & 1);
    delayMicroseconds(104);
  }
  digitalWrite(13, HIGH);
  delayMicroseconds(104);
}
void setup() { pinMode(13, OUTPUT); digitalWrite(13, HIGH); }
void loop() {
  sendByte(72);
  sendByte(105);
  delay(3);
}`;

describe('protocol decoder on a real simulated MCU (bit-banged UART)', () => {
  it('Uno D13 bit-banged 9600 8N1 "Hi" is decoded from the live net buffer', () => {
    const b = new CircuitBuilder();
    b.add('mod_arduino_uno_r3', {}, 0, 0, 0, 'U1');
    b.add('resistor', { r: 10000 }, 9, -4);
    b.add('ground', {}, 9, 3);
    b.chain('U1.D13/SCK', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
    const c: Circuit = { ...b.circuit, firmware: { U1: { kind: 'sketch', source: SKETCH } } };
    const h = harness(c, 0.01); // 0.16 ms simulated per 16 ms frame, 20 substeps -> dt = 8 us
    h.frames(1.0);
    const net = h.last().pinNet.get('U1:D13/SCK')!;
    expect(net).toBeGreaterThan(0);
    const t = h.run.t, v = h.run.nets[net];
    expect(t.length).toBeGreaterThan(500);
    const dt = (t[t.length - 1] - t[0]) / (t.length - 1);
    expect(dt).toBeLessThan(15e-6);
    const tr = toTrace(t, v, 2.5, 0.3);
    const r = decodeUart(tr, { baud: 9600 });
    const bytes = r.frames.map((f) => f.value);
    expect(bytes.length).toBeGreaterThanOrEqual(4);
    // a ring-buffer cut may clip the first frame; every complete pair must read H, i
    const s = String.fromCharCode(...bytes);
    expect(s).toContain('Hi');
    expect(r.frames.filter((f) => f.error)).toEqual([]);
    // auto baud lands on the standard rate despite 8 us time quantisation
    expect(decodeUart(tr).baud).toBe(9600);
    h.run.stop();
  });
});
