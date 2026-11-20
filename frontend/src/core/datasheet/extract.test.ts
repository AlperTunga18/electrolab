import { describe, expect, it } from 'vitest';
import { extractDatasheet, toLibraryPart, type ExtractedField } from './extract';

const IRFZ44N = `
PD - 91290
IRFZ44N
HEXFET Power MOSFET
N-Channel Advanced Process Technology
VDSS = 55V
RDS(on) = 17.5mΩ
ID = 49A
Package: TO-220AB
Absolute Maximum Ratings
ID @ TC = 25°C Continuous Drain Current, VGS @ 10V 49 A
ID @ TC = 100°C Continuous Drain Current, VGS @ 10V 35 A
IDM Pulsed Drain Current 160 A
PD @TC = 25°C Power Dissipation 94 W
Linear Derating Factor 0.63 W/°C
VGS Gate-to-Source Voltage ± 20 V
TJ, TSTG Operating Junction and Storage Temperature Range -55 to + 175 °C
V(BR)DSS Drain-to-Source Breakdown Voltage 55 V
RDS(on) Static Drain-to-Source On-Resistance 0.0175 Ω VGS = 10V, ID = 25A
VGS(th) Gate Threshold Voltage 2.0 4.0 V VDS = VGS, ID = 250µA
VSD Diode Forward Voltage 1.3 V TJ = 25°C, IS = 25A
`;

const BJT = `
2N3904
NPN General Purpose Amplifier
TO-92
Maximum Ratings
VCEO Collector-Emitter Voltage 40 Vdc
VCBO Collector-Base Voltage 60 Vdc
IC Collector Current - Continuous 200 mAdc
PD Total Device Dissipation @ TA = 25°C 625 mW
Derate above 25°C 5.0 mW/°C
TJ Operating Junction Temperature 150 °C
hFE DC Current Gain (IC = 10 mA, VCE = 1.0 V) 100 300
`;

const DIODE = `
Part Number: 1N4007
General Purpose Rectifier
Package: DO-41
VRRM Maximum Repetitive Peak Reverse Voltage 1000 V
IF(AV) Average Forward Rectified Current 1.0 A
VF Forward Voltage IF = 1.0 A 1.1 V
`;

const byKey = (fs: ExtractedField[], k: string) => fs.find((f) => f.key === k);

describe('extractDatasheet', () => {
  it('extracts IRFZ44N-like MOSFET with verbatim quotes', () => {
    const r = extractDatasheet(IRFZ44N);
    expect(r.kind).toBe('mosfet');
    const g = (k: string) => byKey(r.fields, k)!;
    expect(g('mpn').value).toBe('IRFZ44N');
    expect(g('package').value).toBe('TO-220AB');
    expect(g('pol').value).toBe('n');
    expect(g('vmax').value).toBe(55);
    expect(g('vmax').symbol).toBe('VDSS');
    expect(g('imax').value).toBe(49);
    expect(g('imax').quote).toBe('ID = 49A');
    expect(g('rdson').value).toBeCloseTo(0.0175, 6);
    expect(g('vgsth').value).toBe(3); // 2.0 / 4.0 -> midpoint, flagged low
    expect(g('vgsth').confidence).toBe('low');
    expect(g('vgsth').quote).toContain('2.0 4.0 V');
    expect(g('vgsmax').value).toBe(20);
    expect(g('ptot').value).toBe(94);
    expect(g('tjmax').value).toBe(175);
    expect(r.fields.every((f) => IRFZ44N.includes(f.quote))).toBe(true);
    expect(byKey(r.fields, 'vf')).toBeUndefined(); // body diode VSD must not leak in
  });

  it('takes RDS(on) test VGS from the same line', () => {
    const r = extractDatasheet('RDS(on) Static Drain-to-Source On-Resistance 0.0175 Ω VGS = 10V, ID = 25A');
    expect(byKey(r.fields, 'rdson')!.value).toBeCloseTo(0.0175, 6);
    expect(byKey(r.fields, 'vgstest')!.value).toBe(10);
  });

  it('parses prefixes and comma decimals', () => {
    const r = extractDatasheet('RDS(on) Drain-Source On-Resistance 22 mOhm\nID 1,5 A');
    expect(byKey(r.fields, 'rdson')!.value).toBeCloseTo(0.022, 9);
    expect(byKey(r.fields, 'imax')!.value).toBe(1.5);
    expect(extractDatasheet('Açık direnç RDS(on) 0,022 Ω').fields.find((f) => f.key === 'rdson')!.value).toBeCloseTo(0.022, 9);
  });

  it('extracts a BJT', () => {
    const r = extractDatasheet(BJT);
    expect(r.kind).toBe('bjt');
    const g = (k: string) => byKey(r.fields, k)!;
    expect(g('mpn').value).toBe('2N3904');
    expect(g('pol').value).toBe('npn');
    expect(g('vmax').value).toBe(40);
    expect(g('vmax').symbol).toBe('VCEO');
    expect(g('imax').value).toBeCloseTo(0.2, 9);
    expect(g('ptot').value).toBeCloseTo(0.625, 9);
    expect(g('tjmax').value).toBe(150);
    expect(g('hfe').value).toBe(100);
    expect(g('hfe').confidence).toBe('low');
    expect(g('hfe').quote).toContain('100 300');
    expect(r.missing).not.toContain('hFE');
    expect(g('package').value).toBe('TO-92');
  });

  it('extracts a diode with Vf test current', () => {
    const r = extractDatasheet(DIODE);
    expect(r.kind).toBe('diode');
    expect(byKey(r.fields, 'mpn')!.value).toBe('1N4007');
    expect(byKey(r.fields, 'vmax')!.value).toBe(1000);
    expect(byKey(r.fields, 'imax')!.value).toBe(1);
    expect(byKey(r.fields, 'vf')!.value).toBe(1.1);
    expect(byKey(r.fields, 'vftest')!.value).toBe(1);
  });

  it('garbage yields no fields and no false positives', () => {
    const r = extractDatasheet('Lorem ipsum dolor sit amet, consectetur 12345 adipiscing elit.\nHello world 42 kg, 3 days.\nThe quick brown fox jumps over 7 lazy dogs.');
    expect(r.fields).toEqual([]);
    expect(r.kind).toBe('unknown');
    expect(r.missing.length).toBeGreaterThan(5);
    expect(r.missing).toContain('RDS(on)');
    expect(extractDatasheet('').fields).toEqual([]);
  });

  it('reports missing fields when only partly present', () => {
    const r = extractDatasheet('IRFZ44N\nN-Channel MOSFET\nVDSS = 55V');
    expect(r.kind).toBe('mosfet');
    expect(r.missing).toContain('RDS(on)');
    expect(r.missing).toContain('VGS(th)');
  });
});

describe('toLibraryPart', () => {
  it('builds a MOSFET part when all required fields exist', () => {
    const r = extractDatasheet(IRFZ44N);
    const p = toLibraryPart(r.fields);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.def.model).toBe('nmos');
      expect(p.def.userMade).toBe(true);
      expect(p.def.verified).toBe(false);
      expect(p.def.type).toBe('user_irfz44n');
      expect(p.def.params.find((x) => x.key === 'vdsmax')!.default).toBe(55);
    }
  });

  it('refuses with missing list instead of inventing values', () => {
    const r = extractDatasheet('IRFZ44N\nN-Channel MOSFET\nVDSS = 55V\nID = 49A');
    const p = toLibraryPart(r.fields);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.missing).toEqual(expect.arrayContaining(['RDS(on)', 'VGS(th)', 'Maks. |VGS|']));
  });

  it('builds BJT and diode, refuses garbage', () => {
    const b = toLibraryPart(extractDatasheet(BJT).fields);
    expect(b.ok && b.def.model).toBe('npn');
    const d = toLibraryPart(extractDatasheet(DIODE).fields);
    expect(d.ok && d.def.model).toBe('diode');
    expect(toLibraryPart([]).ok).toBe(false);
  });
});
