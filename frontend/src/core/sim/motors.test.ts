import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import { Sim, solveDCOnce } from './mna';

const stepper = (extra: Record<string, number | string | boolean> = {}) => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: 3 }, 0, 0, 0, 'VA'); b.add('dc_supply', { v: 0 }, 0, 0, 0, 'VB');
  b.add('stepper_2ph', extra, 0, 0, 0, 'M1'); b.add('ground');
  b.chain('VA.P', 'M1.A+'); b.chain('M1.A-', 'GND1.G'); b.chain('VA.N', 'GND1.G');
  b.chain('VB.P', 'M1.B+'); b.chain('M1.B-', 'GND1.G'); b.chain('VB.N', 'GND1.G');
  return b.circuit;
};

/** drive the phase sequence; returns rotor angle (deg) sampled at the end of each hold */
function runSequence(extra: Record<string, number | string | boolean>, seq: [number, number][], hold = 0.25, dt = 1e-4): number[] {
  const sim = new Sim(stepper(extra));
  sim.init();
  const va = sim.elems.find((e) => e.k === 'V' && e.owner === 'VA'), vb = sim.elems.find((e) => e.k === 'V' && e.owner === 'VB');
  if (!va || !vb || va.k !== 'V' || vb.k !== 'V') throw new Error('sources missing');
  const out: number[] = [];
  for (const [a, b] of seq) {
    va.v = a; vb.v = b;
    const n = Math.round(hold / dt);
    for (let k = 0; k < n; k++) sim.step(dt);
    out.push(sim.results().M1.vals.angle);
  }
  return out;
}

describe('stepper 2-phase', () => {
  it('DC: current into an energised coil = V/R (rotor parked at the A detent)', () => {
    const { results } = solveDCOnce(stepper());
    expect(results.M1.vals.iA).toBeCloseTo(3 / 7.5, 6);
    expect(Math.abs(results.M1.vals.omega)).toBeLessThan(1e-6);
    expect(results.M1.vals.iB).toBeCloseTo(0, 9);
  });

  it('A, B, -A, -B advances one full step (1.8°) per phase change; reverse order goes back', () => {
    const step = 360 / 200;
    const fwd = runSequence({}, [[3, 0], [0, 3], [-3, 0], [0, -3], [3, 0]]);
    fwd.forEach((a, k) => expect(Math.abs(a - k * step)).toBeLessThan(0.15));
    const rev = runSequence({}, [[3, 0], [0, -3], [-3, 0], [0, 3]]);
    rev.forEach((a, k) => expect(Math.abs(a + k * step)).toBeLessThan(0.15));
  });

  it('overloaded (load torque > holding torque) stalls: angle stays well below the commanded one', () => {
    const seq: [number, number][] = [[3, 0], [0, 3], [-3, 0], [0, -3]];
    const free = runSequence({}, seq)[3];
    const stalled = runSequence({ tload: 0.3 }, seq)[3];
    expect(free).toBeGreaterThan(5);
    expect(stalled).toBeLessThan(0.5 * free);
  });
});

const servo = (extra: Record<string, number | string | boolean> = {}, dutyPct = 7.5, vcc = 5) => {
  const b = new CircuitBuilder();
  b.add('dc_supply', { v: vcc }, 0, 0, 0, 'V1');
  b.add('signal_gen', { wave: 'square', v: 2.5, amp: 2.5, freq: 50, duty: dutyPct }, 0, 0, 0, 'V2');
  b.add('servo_sg90', extra, 0, 0, 0, 'S1'); b.add('ground');
  b.chain('V1.P', 'S1.VCC'); b.chain('S1.GND', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  b.chain('V2.P', 'S1.SIG'); b.chain('V2.N', 'GND1.G');
  return b.circuit;
};

function runServo(extra: Record<string, number | string | boolean>, dutyPct: number, stop: number, dt = 2e-5) {
  const sim = new Sim(servo(extra, dutyPct));
  sim.init();
  const n = Math.round(stop / dt);
  let mid = sim.results().S1;
  for (let k = 0; k < n; k++) { sim.step(dt); if (k === Math.round(0.05 / dt)) mid = sim.results().S1; }
  return { end: sim.results().S1, mid };
}

describe('hobby servo (behavioural)', () => {
  it('1.5 ms / 20 ms pulse train: angle goes 0° -> 90° (+-2°), slew-limited, then draws idle current', () => {
    const { end, mid } = runServo({ a0: 0 }, 7.5, 0.5);
    expect(Math.abs(end.vals.angle - 90)).toBeLessThan(2);
    expect(Math.abs(end.vals.pulse - 1.5)).toBeLessThan(0.05);
    expect(mid.vals.angle).toBeLessThanOrEqual(600 * 0.05 + 1);  // <= 60°/0.1 s
    expect(mid.vals.angle).toBeGreaterThan(10);
    expect(mid.vals.moving).toBe(1);
    expect(mid.i).toBeGreaterThan(0.2);                          // moving current ~250 mA
    expect(end.vals.moving).toBe(0);
    expect(end.i).toBeLessThan(0.02);                            // idle ~10 mA
  });

  it('1.0 ms -> 0°, 2.0 ms -> 180°, over-range pulse clamps at 180°', () => {
    expect(runServo({ a0: 90 }, 5, 0.6).end.vals.angle).toBeLessThan(2);
    expect(Math.abs(runServo({ a0: 90 }, 10, 0.6).end.vals.angle - 180)).toBeLessThan(2);
    expect(runServo({ a0: 90 }, 12.5, 0.6).end.vals.angle).toBeCloseTo(180, 0);
  });

  it('blocked horn: angle frozen, stall current ~650 mA', () => {
    const { end } = runServo({ a0: 0, blocked: true }, 7.5, 0.3);
    expect(end.vals.angle).toBe(0);
    expect(end.i).toBeGreaterThan(0.6);
  });
});
