import { describe, expect, it } from 'vitest';
import { parseSpice, parseSpiceNumber } from './parse';
import { buildUserPart } from './toPart';

// Generic textbook-style example cards written for this test; NOT official models.
const CARDS = `* generic examples
.MODEL DGEN D (IS=2.5n RS=0.6 N=1.75 BV=100 CJO=4p TT=12n)
.model qgen NPN (Is=6.7f
+ Bf=416 Br=6.7 Vaf=74 Cje=4.5p
+ Cjc=3.6p Tf=300p)
.MODEL PGEN PNP(IS=1e-14 BF=180 VAF=50)
.model nm NMOS (LEVEL=1 VTO=2.1 KP=0.1 LAMBDA=0.02 CGSO=1n)
.model pm PMOS (VTO=-1.5 KP=40u)
.SUBCKT opamp 1 2 3 4 5
R1 1 2 1k
.ENDS
.model weird NJF (VTO=-2)
.model expr D (IS={1e-14*2} N=1)
`;

describe('spice numbers', () => {
  it('SI suffixes', () => {
    expect(parseSpiceNumber('2.5n')).toBeCloseTo(2.5e-9);
    expect(parseSpiceNumber('1meg')).toBe(1e6);
    expect(parseSpiceNumber('1MEG')).toBe(1e6);
    expect(parseSpiceNumber('2mil')).toBeCloseTo(50.8e-6);
    expect(parseSpiceNumber('6.7f')).toBeCloseTo(6.7e-15);
    expect(parseSpiceNumber('4pF')).toBeCloseTo(4e-12);
    expect(parseSpiceNumber('1e-14')).toBe(1e-14);
    expect(parseSpiceNumber('5m')).toBe(5e-3);
    expect(parseSpiceNumber('{1+2}')).toBeNull();
    expect(parseSpiceNumber('abc')).toBeNull();
  });
});

describe('parseSpice', () => {
  const r = parseSpice(CARDS);
  const get = (n: string) => r.models.find((m) => m.name.toLowerCase() === n)!;
  it('diode mapping and ignored list', () => {
    const d = get('dgen');
    expect(d.kind).toBe('D');
    expect(d.mapped.is).toBeCloseTo(2.5e-9);
    expect(d.mapped.n).toBe(1.75);
    expect(d.ignored.map((i) => i.name).sort()).toEqual(['bv', 'cjo', 'rs', 'tt']);
  });
  it('BJT with continuation lines', () => {
    const q = get('qgen');
    expect(q.mapped.is).toBeCloseTo(6.7e-15);
    expect(q.mapped.bf).toBe(416);
    expect(q.ignored.map((i) => i.name).sort()).toEqual(['br', 'cjc', 'cje', 'tf', 'vaf']);
    expect(get('pgen').kind).toBe('PNP');
  });
  it('MOSFET level 1', () => {
    const n = get('nm');
    expect(n.mapped).toEqual({ vth: 2.1, k: 0.05, lambda: 0.02 });
    expect(n.ignored.map((i) => i.name)).toEqual(['cgso']);
    expect(get('pm').mapped.vth).toBe(1.5);
    expect(get('pm').mapped.k).toBeCloseTo(20e-6);
    expect(get('pm').warnings.join()).toMatch(/W\/L/);
  });
  it('subckt not simulated, unsupported types and expressions reported', () => {
    expect(r.subckts).toHaveLength(1);
    expect(r.subckts[0].name).toBe('opamp');
    expect(r.subckts[0].pins).toEqual(['1', '2', '3', '4', '5']);
    expect(r.subckts[0].message).toContain('desteklenmiyor');
    expect(r.unsupported.join()).toContain('weird');
    const e = get('expr');
    expect(e.mapped).toEqual({ n: 1 });
    expect(e.ignored[0]).toMatchObject({ name: 'is', reason: expect.stringContaining('ifade') });
  });
  it('empty input warns', () => {
    expect(parseSpice('hello').warnings.length).toBe(1);
  });
});

describe('buildUserPart', () => {
  it('sets params, unverified, SPICE source', () => {
    const r = parseSpice(CARDS);
    const d = buildUserPart(r.models[0], { now: 1 });
    expect(d.verified).toBe(false);
    expect(d.userMade).toBe(true);
    expect(d.specs?.Kaynak).toBe('SPICE içe aktarma');
    expect(d.params.find((p) => p.key === 'is')?.default).toBeCloseTo(2.5e-9);
    expect(d.params.find((p) => p.key === 'n')?.default).toBe(1.75);
    const m = buildUserPart(r.models.find((x) => x.name === 'nm')!, { wOverL: 10, now: 1 });
    expect(m.params.find((p) => p.key === 'k')?.default).toBeCloseTo(0.5);
    expect(m.params.find((p) => p.key === 'vth')?.default).toBe(2.1);
  });
});
