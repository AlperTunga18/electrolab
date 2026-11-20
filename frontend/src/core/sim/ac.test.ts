import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import { acSweep, analyzeResponse, diodeTest, insulationTest, measureImpedance } from './ac';
import { solveDCOnce } from './mna';

const close = (a: number, b: number, rel = 1e-3, abs = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(abs + rel * Math.abs(b));
const at = (f: number[], target: number) => f.reduce((best, x, i) => (Math.abs(Math.log(x / target)) < Math.abs(Math.log(f[best] / target)) ? i : best), 0);

function rcLow() {
  const b = new CircuitBuilder();
  b.add('signal_gen', { wave: 'sine', amp: 1, freq: 1000 }); b.add('resistor', { r: 1000 }); b.add('capacitor', { c: 159.1549e-9 }); b.add('ground');
  b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'C1.1'); b.chain('C1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
  return b.circuit;
}

describe('AC sweep', () => {
  it('RC low-pass: |H(fc)| = 0.7071, phase -45 deg, f-3dB = 1 kHz, 20 dB/decade roll-off', () => {
    const r = acSweep(rcLow(), { source: 'V1', probes: [{ comp: 'C1', pin: '1' }], fStart: 10, fStop: 1e6, ppd: 50 });
    const i = at(r.f, 1000);
    close(r.mag[0][i], Math.SQRT1_2, 0.02);
    close(r.phase[0][i], -45, 0.03);
    const info = analyzeResponse(r.f, r.mag[0]);
    expect(info.kind).toBe('lowpass');
    close(info.f3db!, 1000, 0.03);
    close(r.mag[0][0], 1, 1e-3);
    const i10k = at(r.f, 1e4), i100k = at(r.f, 1e5);
    close(r.mag[0][i10k] / r.mag[0][i100k], 10, 0.02);
  });

  it('RC high-pass classified as high-pass with f-3dB at 1 kHz', () => {
    const b = new CircuitBuilder();
    b.add('signal_gen', { wave: 'sine', amp: 1, freq: 1000 }); b.add('capacitor', { c: 159.1549e-9 }); b.add('resistor', { r: 1000 }); b.add('ground');
    b.chain('V1.P', 'C1.1'); b.chain('C1.2', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const r = acSweep(b.circuit, { source: 'V1', probes: [{ comp: 'R1', pin: '1' }], fStart: 10, fStop: 1e6 });
    const info = analyzeResponse(r.f, r.mag[0]);
    expect(info.kind).toBe('highpass');
    close(info.f3db!, 1000, 0.03);
  });

  it('series RLC across R: resonance f0 = 1/(2π√LC), Q = (1/R)√(L/C), unity gain at f0', () => {
    const L = 10e-3, C = 1e-6, R = 10;
    const b = new CircuitBuilder();
    b.add('signal_gen', { wave: 'sine', amp: 1, freq: 1000 }); b.add('inductor', { l: L }); b.add('capacitor', { c: C }); b.add('resistor', { r: R }); b.add('ground');
    b.chain('V1.P', 'L1.1'); b.chain('L1.2', 'C1.1'); b.chain('C1.2', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const r = acSweep(b.circuit, { source: 'V1', probes: [{ comp: 'R1', pin: '1' }], fStart: 100, fStop: 20000, ppd: 200 });
    const info = analyzeResponse(r.f, r.mag[0]);
    const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));
    expect(info.kind).toBe('bandpass');
    close(info.peakF, f0, 0.02);
    close(info.peakGain, R / (R + 0), 0.02); // coil/cap are ideal -> |H| = 1
    close(info.q!, (1 / R) * Math.sqrt(L / C), 0.05);
  });

  it('BJT common-emitter amplifier: mid-band gain vc/vb = -gm·RC with gm = Ic/Vt', () => {
    const b = new CircuitBuilder();
    b.add('signal_gen', { wave: 'sine', amp: 0.01, freq: 1000, v: 0 }, 0, 0, 0, 'VS'); b.add('dc_supply', { v: 12 }, 0, 0, 0, 'VCC');
    b.add('capacitor', { c: 10e-6 }, 0, 0, 0, 'CIN'); b.add('resistor', { r: 47000 }, 0, 0, 0, 'RB1'); b.add('resistor', { r: 10000 }, 0, 0, 0, 'RB2');
    b.add('resistor', { r: 2200 }, 0, 0, 0, 'RC'); b.add('resistor', { r: 1000 }, 0, 0, 0, 'RE'); b.add('capacitor', { c: 1e-3 }, 0, 0, 0, 'CE');
    b.add('npn', { bf: 200 }, 0, 0, 0, 'Q1'); b.add('ground');
    b.chain('VS.P', 'CIN.1'); b.chain('CIN.2', 'Q1.B'); b.chain('Q1.B', 'RB1.2'); b.chain('Q1.B', 'RB2.1');
    b.chain('VCC.P', 'RB1.1'); b.chain('VCC.P', 'RC.1'); b.chain('RC.2', 'Q1.C'); b.chain('Q1.E', 'RE.1'); b.chain('Q1.E', 'CE.1');
    b.chain('RE.2', 'GND1.G'); b.chain('CE.2', 'GND1.G'); b.chain('RB2.2', 'GND1.G'); b.chain('VS.N', 'GND1.G'); b.chain('VCC.N', 'GND1.G');
    const { results } = solveDCOnce(b.circuit);
    const ic = results.Q1.vals.ic;
    expect(ic).toBeGreaterThan(0.5e-3);
    const gm = ic / 0.025852;
    const r = acSweep(b.circuit, { source: 'VS', probes: [{ comp: 'Q1', pin: 'C' }, { comp: 'Q1', pin: 'B' }], fStart: 1000, fStop: 10000, ppd: 5 });
    const k = at(r.f, 5000);
    const gain = r.mag[0][k] / r.mag[1][k];
    close(gain, gm * 2200, 0.05);
    expect(Math.abs(Math.abs(r.phase[0][k] - r.phase[1][k]) - 180)).toBeLessThan(5);
  });

  it('diode small-signal: divider with rd = n·Vt/Id', () => {
    const b = new CircuitBuilder();
    b.add('signal_gen', { wave: 'sine', amp: 1, freq: 1000, v: 5 }); b.add('resistor', { r: 4300 }); b.add('diode'); b.add('ground');
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'D1.A'); b.chain('D1.K', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const { results } = solveDCOnce(b.circuit);
    const id = results.D1.i;
    const rd = (1.752 * 0.025852) / id;
    const r = acSweep(b.circuit, { source: 'V1', probes: [{ comp: 'D1', pin: 'A' }], fStart: 1000, fStop: 2000, ppd: 2 });
    close(r.mag[0][0], rd / (4300 + rd), 0.02);
  });

  it('transformer (secondary open): |Vs/Vp| = k/n at 50 Hz', () => {
    const b = new CircuitBuilder();
    b.add('signal_gen', { wave: 'sine', amp: 1, freq: 50 }); b.add('transformer'); b.add('ground');
    b.chain('V1.P', 'TR1.P1'); b.chain('TR1.P2', 'GND1.G'); b.chain('V1.N', 'GND1.G'); b.chain('TR1.S2', 'GND1.G');
    const r = acSweep(b.circuit, { source: 'V1', probes: [{ comp: 'TR1', pin: 'S1' }], fStart: 50, fStop: 100, ppd: 2 });
    close(r.mag[0][0], 0.098, 0.01);
  });
});

describe('powered-off measurements', () => {
  it('LCR: capacitor, inductor, resistor with ESR', () => {
    const cap = new CircuitBuilder(); cap.add('capacitor', { c: 1e-6 }); cap.add('ground'); cap.chain('C1.2', 'GND1.G');
    const z = measureImpedance(cap.circuit, { comp: 'C1', pin: '1' }, { comp: 'C1', pin: '2' }, 1000);
    close(z.cs!, 1e-6, 1e-3); expect(z.im).toBeLessThan(0);
    const ind = new CircuitBuilder(); ind.add('inductor', { l: 10e-3 }); ind.add('ground'); ind.chain('L1.2', 'GND1.G');
    const zl = measureImpedance(ind.circuit, { comp: 'L1', pin: '1' }, { comp: 'L1', pin: '2' }, 1000);
    close(zl.ls!, 10e-3, 1e-3);
    // series R + C: ESR = R
    const rc = new CircuitBuilder(); rc.add('resistor', { r: 0.5 }); rc.add('capacitor', { c: 100e-6 }); rc.add('ground');
    rc.chain('R1.2', 'C1.1'); rc.chain('C1.2', 'GND1.G');
    const zs = measureImpedance(rc.circuit, { comp: 'R1', pin: '1' }, { comp: 'C1', pin: '2' }, 100000);
    close(zs.rs, 0.5, 1e-3, 1e-6);
  });

  it('ohmmeter in a de-energised network: the ideal source is a short, so RS || R1 || R2 = 400 ohm', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 12 }); b.add('resistor', { r: 1000 }, 0, 0, 0, 'RS'); b.add('resistor', { r: 1000 }, 0, 0, 0, 'R1'); b.add('resistor', { r: 2000 }, 0, 0, 0, 'R2'); b.add('ground');
    b.chain('V1.P', 'RS.1'); b.chain('RS.2', 'R1.1', 'R2.1'); b.chain('R1.2', 'GND1.G'); b.chain('R2.2', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    const z = measureImpedance(b.circuit, { comp: 'R1', pin: '1' }, { comp: 'R1', pin: '2' }, 0);
    close(z.rs, 400, 1e-3);
  });

  it('diode test: forward 0.55-0.8 V, reverse = OL', () => {
    const b = new CircuitBuilder(); b.add('diode'); b.add('ground'); b.chain('D1.K', 'GND1.G');
    const fwd = diodeTest(b.circuit, { comp: 'D1', pin: 'A' }, { comp: 'D1', pin: 'K' });
    expect(fwd.volts).toBeGreaterThan(0.55); expect(fwd.volts).toBeLessThan(0.85); expect(fwd.open).toBe(false);
    const rev = diodeTest(b.circuit, { comp: 'D1', pin: 'K' }, { comp: 'D1', pin: 'A' });
    expect(rev.open).toBe(true);
  });

  it('insulation tester: 500 V across a leaky transformer insulation reads the leak resistance', () => {
    const b = new CircuitBuilder(); b.add('transformer'); b.add('ground');
    b.circuit.faults = { TR1: { kind: 'leak', amount: 2e6 } };
    const healthy = new CircuitBuilder(); healthy.add('transformer'); healthy.add('ground');
    const bad = insulationTest(b.circuit, { comp: 'TR1', pin: 'P1' }, { comp: 'TR1', pin: 'S1' }, 500);
    close(bad.ohms, 2e6, 0.01);
    const good = insulationTest(healthy.circuit, { comp: 'TR1', pin: 'P1' }, { comp: 'TR1', pin: 'S1' }, 500);
    expect(good.ohms).toBeGreaterThan(1e9);
  });
});
