import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../examples/examples';
import { TEMPLATES } from './templates';
import { LiveRunner, type LiveSnapshot } from '../sim/runner';
import { createRuntime } from './factory';
import { getDef } from '../../library/components';
import type { FailureReport } from '../sim/damage';

/** Drives the real LiveRunner with a fake animation clock. */
function harness(circuit: Parameters<LiveRunner['start']>[0], speed: number) {
  const g = globalThis as unknown as { requestAnimationFrame: (f: (t: number) => void) => number; cancelAnimationFrame: (n: number) => void };
  const raf: { cb: ((t: number) => void) | null } = { cb: null };
  g.requestAnimationFrame = (f) => { raf.cb = f; return 1; };
  g.cancelAnimationFrame = () => { raf.cb = null; };
  const snaps: LiveSnapshot[] = [];
  const serial: string[] = [];
  const reports: FailureReport[] = [];
  const logs: string[] = [];
  const run = new LiveRunner((s) => snaps.push(s), (e) => { throw e; }, () => {}, (r) => reports.push(r), {
    serial: (_c, t) => serial.push(t), log: (_c, _l, t) => logs.push(t),
  });
  run.speed = speed; run.damageEnabled = true;
  run.start(circuit);
  let now = performance.now();
  /** advance wall clock by `seconds` in 16 ms frames */
  const frames = (seconds: number, each?: () => void) => { for (let t = 0; t < seconds; t += 0.016) { now += 16; raf.cb?.(now); each?.(); } };
  return { run, snaps, serial, reports, logs, frames, last: () => snaps[snaps.length - 1] };
}

describe('sketch templates compile on their boards', () => {
  for (const t of TEMPLATES) {
    for (const board of ['mod_arduino_uno_r3', 'mod_esp32_devkit_v1', 'mod_raspberry_pi_pico']) {
      it(`${t.id} on ${board}`, () => {
        const rt = createRuntime('sketch', getDef(board).mcu!)!;
        const res = rt.load(t.code);
        expect(res.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
        expect(res.ok).toBe(true);
      });
    }
  }
});

describe('firmware drives the electrical simulation (end to end)', () => {
  it('Uno Blink: D13 toggles, LED current follows, Serial prints', () => {
    const h = harness(EXAMPLES.find((e) => e.id === 'mcu_blink')!.build(), 1);
    const iLed: number[] = [];
    h.frames(2.3, () => { const s = h.last(); if (s) iLed.push(s.comps.D1.i); });
    const on = iLed.filter((i) => i > 0.008), off = iLed.filter((i) => Math.abs(i) < 1e-4);
    expect(on.length).toBeGreaterThan(10);
    expect(off.length).toBeGreaterThan(10);
    expect(Math.max(...iLed)).toBeLessThan(0.016);          // (5 - 1.9) / (220 + 40) ~ 12 mA
    const text = h.serial.join('');
    expect(text).toContain('LED yandi');
    expect(text).toContain('LED sondu');
    expect(h.last().gpio.U1.find((g) => g.pin === 'D13/SCK')!.mode).toBe('out');
    h.run.stop();
  });

  it('Button example: pressing the switch pulls D2 low and lights the LED', () => {
    const c = EXAMPLES.find((e) => e.id === 'mcu_button')!.build();
    const h = harness(c, 1);
    h.frames(0.3);
    expect(h.last().comps.D1.i).toBeLessThan(1e-4);                    // not pressed
    expect(h.last().comps.U1.vals['v_D2']).toBeGreaterThan(4.5);       // pulled up
    const sw = { ...c, components: c.components.map((x) => (x.id === 'SW1' ? { ...x, params: { ...x.params, closed: true } } : x)) };
    h.run.update(sw);
    h.frames(0.3);
    expect(h.last().comps.U1.vals['v_D2']).toBeLessThan(0.3);
    expect(h.last().comps.D1.i).toBeGreaterThan(0.008);                // LED on
    h.run.stop();
  });

  it('Pot -> ADC -> PWM: duty follows the wiper and Serial reports ADC', () => {
    const h = harness(EXAMPLES.find((e) => e.id === 'mcu_pot_pwm')!.build(), 0.02);
    h.frames(1.5);
    const text = h.serial.join('');
    const m = [...text.matchAll(/ADC=(\d+) PWM=(\d+)/g)].pop()!;
    expect(Number(m[1])).toBeGreaterThan(700);                         // 3.5 V of 5 V -> ~716
    expect(Number(m[1])).toBeLessThan(730);
    const g = h.last().gpio.U1.find((x) => x.pin === 'D9')!;
    expect(g.mode).toBe('pwm');
    expect(g.duty!).toBeGreaterThan(0.6); expect(g.duty!).toBeLessThan(0.8);
    h.run.stop();
  });

  it('ESP32 GPIO26 -> MOSFET -> 12 V load switches with the sketch timing (2 s on / 3 s off)', () => {
    const h = harness(EXAMPLES.find((e) => e.id === 'esp32_mosfet')!.build(), 1);
    const iLoad: [number, number][] = [];
    h.frames(5.2, () => { const s = h.last(); if (s) iLoad.push([s.t, s.comps.RL.i]); });
    const at = (t: number) => iLoad.reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a))[1];
    expect(at(1.0)).toBeGreaterThan(0.9);       // on
    expect(at(3.5)).toBeLessThan(1e-3);         // off
    h.run.stop();
  });

  it('ESP32 with 5 V on a GPIO: pin is flagged, destroyed, and a report is produced', () => {
    const h = harness(EXAMPLES.find((e) => e.id === 'esp32_5v')!.build(), 1);
    h.frames(1.0);
    const rep = h.reports.find((r) => r.ref === 'U1.D4');
    expect(rep).toBeTruthy();
    expect(rep!.cause).toBe('overvoltage');
    expect(rep!.fix.join(' ')).toMatch(/bölücü|seviye/);
    expect(h.last().deadPins.U1).toContain('D4');
    h.run.stop();
  });

  it('a sketch with a syntax error is not started and reports diagnostics', () => {
    const c = EXAMPLES.find((e) => e.id === 'mcu_blink')!.build();
    c.firmware!.U1 = { kind: 'sketch', source: 'void setup() { pinMode(13, OUTPUT) }\nvoid loop() {}' };
    const h = harness(c, 1);
    h.frames(0.2);
    expect(h.run.mcus.size).toBe(0);
    expect(h.logs.some((l) => l.includes('derlenemedi'))).toBe(true);
    h.run.stop();
  });
});
