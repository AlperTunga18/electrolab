import { describe, expect, it } from 'vitest';
import type { McuBoardSpec } from '../types';
import { SketchRuntime } from './index';

const base = { vcc: 5, cpuHz: 16e6, adcBits: 10, adcVref: 5, pwmHz: 490, rOutHigh: 25, rOutLow: 25, rPullup: 30000, imaxPin: 0.04, vInMargin: 0.5, supplies: [], gnd: ['GND'], notes: [] };
const pins = (ns: number[]): Record<number, string> => Object.fromEntries(ns.map((n) => [n, `D${n}`]));
const uno: McuBoardSpec = { ...base, family: 'avr', intBits: 16, pinMap: pins([2, 3, 4, 5, 13]), constants: { LED_BUILTIN: 13 }, pwmPins: [], adcPins: [], inputOnly: [], intPins: [2, 3] };
const mega: McuBoardSpec = { ...uno, pinMap: pins([2, 3, 18, 19, 20, 21]), intPins: [2, 3, 21, 20, 19, 18] };
const esp: McuBoardSpec = { ...base, family: 'esp32', vcc: 3.3, intBits: 32, cpuHz: 240e6, adcBits: 12, adcVref: 3.3, pinMap: { 4: 'G4', 5: 'G5' }, constants: {}, pwmPins: [], adcPins: [], inputOnly: [] };

/** run a sketch with a time-dependent voltage on one pin; returns Serial lines and warnings */
function run(src: string, spec: McuBoardSpec, pinId: string, sig: (us: number) => number, toS: number, dtUs = 20) {
  const rt = new SketchRuntime(spec);
  const out: string[] = [];
  rt.onSerial = (t) => out.push(t);
  const res = rt.load(src);
  expect(res.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  let us = 0;
  const host = { readVoltage: (id: string) => (id === pinId ? sig(us) : 0) };
  const n = Math.round((toS * 1e6) / dtUs);
  for (let i = 1; i <= n; i++) {
    us = i * dtUs;
    rt.advance(us / 1e6, host);
  }
  return { rt, lines: out.join('').split('\r\n').filter(Boolean), warnings: rt.warnings() };
}

const hi = (v: number) => v * 1;
/** 1 kHz train, high from 0.3 ms to 0.8 ms of every period */
const train = (us: number) => (us % 1000 >= 300 && us % 1000 < 800 ? hi(5) : 0);
/** 5 rising edges, only 4 falling (stays high after the 5th rising edge) */
const burst = (us: number) => (us >= 4300 ? 5 : train(us));

const counter = (mode: string, pin = 2) => `
volatile unsigned long cnt = 0;
void isr() { cnt++; }
void setup() { Serial.begin(9600); attachInterrupt(digitalPinToInterrupt(${pin}), isr, ${mode}); }
void loop() { delay(100); Serial.println(cnt); delay(100000); }`;

describe('attachInterrupt: edge counting from a signal source', () => {
  it('RISING counts rising edges only', () => {
    expect(run(counter('RISING'), uno, 'D2', train, 0.11).lines).toEqual(['100']);
  });
  it('FALLING counts falling edges only', () => {
    expect(run(counter('FALLING'), uno, 'D2', train, 0.11).lines).toEqual(['100']);
  });
  it('CHANGE counts both edges', () => {
    expect(run(counter('CHANGE'), uno, 'D2', train, 0.11).lines).toEqual(['200']);
  });
  it('RISING vs FALLING vs CHANGE differ on an unbalanced burst (5 rising, 4 falling)', () => {
    const c = (m: string) => run(counter(m), uno, 'D2', burst, 0.11).lines[0];
    expect(c('RISING')).toBe('5');
    expect(c('FALLING')).toBe('4');
    expect(c('CHANGE')).toBe('9');
  });
  it('ESP32: any GPIO can interrupt (digitalPinToInterrupt returns the pin)', () => {
    const r = run(counter('RISING', 4), esp, 'G4', (us) => (train(us) ? 3.3 : 0), 0.11);
    expect(r.lines).toEqual(['100']);
    expect(r.warnings).toEqual([]);
  });
  it('counts while the main program sleeps in a long delay(): 1 kHz for 1 s', () => {
    const src = `volatile unsigned long cnt = 0; void isr(){ cnt++; }
void setup(){ attachInterrupt(digitalPinToInterrupt(2), isr, RISING); }
void loop(){ Serial.println(cnt); delay(1000); }`;
    const r = run(src, uno, 'D2', train, 1.01, 50);
    expect(r.lines[0]).toBe('0');
    expect(r.lines[1]).toBe('1000');
  });
  it('detachInterrupt stops counting', () => {
    const src = `volatile int n = 0; void isr(){ n++; }
void setup(){ attachInterrupt(digitalPinToInterrupt(2), isr, RISING); }
void loop(){ delay(10); detachInterrupt(digitalPinToInterrupt(2)); delay(40); Serial.println(n); delay(100000); }`;
    const r = run(src, uno, 'D2', train, 0.06);
    expect(r.lines).toEqual(['10']); // rising edges at 0.3 ms .. 9.3 ms
  });
  it('resolution limit: pulses shorter than the step are missed (documented behaviour)', () => {
    const narrow = (us: number) => (us % 1000 >= 520 && us % 1000 < 530 ? 5 : 0); // 10 us pulses between two 100 us samples
    const r = run(counter('RISING'), uno, 'D2', narrow, 0.11, 100); // 100 us steps
    expect(Number(r.lines[0])).toBeLessThan(100);
    const fine = run(counter('RISING'), uno, 'D2', narrow, 0.11, 2);
    expect(fine.lines[0]).toBe('100');
  });
});

describe('interrupt API details', () => {
  it('ISR sees millis() of the edge, not of the end of the main delay()', () => {
    const src = `volatile unsigned long t = 999999; void isr(){ t = millis(); }
void setup(){ attachInterrupt(digitalPinToInterrupt(2), isr, RISING); }
void loop(){ delay(100); Serial.println(t); delay(100000); }`;
    const r = run(src, uno, 'D2', (us) => (us >= 500 ? 5 : 0), 0.11);
    expect(Number(r.lines[0])).toBeLessThanOrEqual(1);
  });
  it('delay() inside an ISR is ignored with a warning, the ISR still completes', () => {
    const src = `volatile int n = 0; void isr(){ delay(50); n++; }
void setup(){ attachInterrupt(digitalPinToInterrupt(2), isr, RISING); }
void loop(){ delay(20); Serial.println(n); delay(100000); }`;
    const r = run(src, uno, 'D2', train, 0.03);
    expect(r.lines).toEqual(['20']);
    expect(r.warnings.some((w) => w.includes('ISR içinde delay()'))).toBe(true);
  });
  it('noInterrupts() defers the ISR; pending edges coalesce into one flag (documented)', () => {
    const src = `volatile unsigned long cnt = 0; void isr(){ cnt++; }
void setup(){ attachInterrupt(digitalPinToInterrupt(2), isr, RISING); }
void loop(){ noInterrupts(); delay(20); unsigned long a = cnt; interrupts(); delay(20); Serial.println(a); Serial.println(cnt); delay(100000); }`;
    const r = run(src, uno, 'D2', train, 0.045);
    expect(r.lines[0]).toBe('0');
    expect(r.lines[1]).toBe('21');
  });
  it('an ISR that never returns is reported', () => {
    const src = `volatile int x = 0; void isr(){ while(true){ x++; } }
void setup(){ attachInterrupt(digitalPinToInterrupt(2), isr, RISING); }
void loop(){ delay(1); }`;
    const r = run(src, uno, 'D2', (us) => (us >= 100 ? 5 : 0), 0.01);
    expect(r.warnings.some((w) => w.includes('ISR bitmiyor'))).toBe(true);
  });
  it('Uno: only pins 2 and 3 are external interrupts', () => {
    const src = `void isr(){} void setup(){ int a = digitalPinToInterrupt(5); Serial.println(a); Serial.println(digitalPinToInterrupt(3)); attachInterrupt(a, isr, RISING); } void loop(){}`;
    const r = run(src, uno, 'D2', () => 0, 0.001);
    expect(r.lines).toEqual(['-1', '1']);
    expect(r.warnings.some((w) => w.includes('harici kesme pini değil'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('harici kesme bu kartta yok'))).toBe(true);
  });
  it('Mega: 2,3,18,19,20,21 map to INT0..INT5; legacy interrupt numbers work', () => {
    const src = `void isr(){} void setup(){ Serial.println(digitalPinToInterrupt(2)); Serial.println(digitalPinToInterrupt(21)); Serial.println(digitalPinToInterrupt(18)); Serial.println(digitalPinToInterrupt(4)); } void loop(){}`;
    expect(run(src, mega, 'D2', () => 0, 0.001).lines).toEqual(['0', '2', '5', '-1']);
    const legacy = `volatile int n = 0; void isr(){ n++; } void setup(){ attachInterrupt(2, isr, RISING); } void loop(){ delay(100); Serial.println(n); delay(100000); }`;
    expect(run(legacy, mega, 'D21', train, 0.11).lines).toEqual(['100']); // interrupt 2 = pin 21
  });
  it('LOW level interrupts are rejected with a warning', () => {
    const src = `void isr(){} void setup(){ attachInterrupt(digitalPinToInterrupt(2), isr, LOW); } void loop(){}`;
    expect(run(src, uno, 'D2', () => 0, 0.001).warnings.some((w) => w.includes('LOW/HIGH seviye'))).toBe(true);
  });
  it('compile errors: ISR must be a void function without parameters; IRAM_ATTR is accepted', () => {
    const rt = new SketchRuntime(uno);
    const bad = rt.load('int isr(){ return 1; } void setup(){ attachInterrupt(0, isr, RISING); } void loop(){}');
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics[0].message).toContain('void isr()');
    const notFn = rt.load('void setup(){ attachInterrupt(0, 5, RISING); } void loop(){}');
    expect(notFn.ok).toBe(false);
    const ok = new SketchRuntime(esp).load('volatile bool f = false; void IRAM_ATTR isr(){ f = true; } void setup(){ attachInterrupt(digitalPinToInterrupt(4), isr, FALLING); } void loop(){}');
    expect(ok.ok).toBe(true);
  });
});
