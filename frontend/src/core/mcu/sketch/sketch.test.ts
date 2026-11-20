import { describe, expect, it } from 'vitest';
import type { McuBoardSpec, McuHost } from '../types';
import { SketchRuntime } from './index';

const base = {
  vcc: 5,
  cpuHz: 16e6,
  adcBits: 10,
  adcVref: 5,
  pwmHz: 490,
  rOutHigh: 25,
  rOutLow: 25,
  rPullup: 30000,
  imaxPin: 0.04,
  vInMargin: 0.5,
  supplies: [],
  gnd: ['GND'],
  notes: [],
};
const avr: McuBoardSpec = {
  ...base,
  family: 'avr',
  intBits: 16,
  pinMap: { 0: 'D0', 1: 'D1', 2: 'D2', 3: 'D3', 4: 'D4', 5: 'D5', 6: 'D6', 8: 'D8', 9: 'D9', 10: 'D10', 11: 'D11', 13: 'D13', 14: 'A0', 15: 'A1' },
  constants: { A0: 14, A1: 15, LED_BUILTIN: 13 },
  pwmPins: [3, 5, 6, 9, 10, 11],
  adcPins: [14, 15],
  inputOnly: [],
};
const esp: McuBoardSpec = {
  ...base,
  family: 'esp32',
  vcc: 3.3,
  intBits: 32,
  cpuHz: 240e6,
  adcBits: 12,
  adcVref: 3.3,
  pinMap: { 2: 'G2', 4: 'G4', 5: 'G5', 34: 'G34', 35: 'G35' },
  constants: { LED_BUILTIN: 2 },
  pwmPins: [2, 4, 5],
  adcPins: [34, 35],
  inputOnly: [34, 35],
};

const host = (v: Record<string, number> = {}): McuHost => ({ readVoltage: (id) => v[id] ?? 0 });

interface Rig {
  rt: SketchRuntime;
  out: string[];
  text: () => string;
  run: (to: number, h?: McuHost, step?: number) => void;
  h: McuHost;
}
function rig(src: string, spec: McuBoardSpec = avr, volts: Record<string, number> = {}): Rig {
  const rt = new SketchRuntime(spec);
  const out: string[] = [];
  rt.onSerial = (t) => out.push(t);
  const res = rt.load(src);
  expect(res.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const r: Rig = {
    rt,
    out,
    text: () => out.join(''),
    h: host(volts),
    run(to, h = r.h, step = 0.001) {
      for (let t = step; t <= to + 1e-9; t += step) rt.advance(t, h);
    },
  };
  return r;
}
/** println-separated lines of the serial output */
const lines = (r: Rig): string[] => r.text().split('\r\n').filter((x) => x.length);
/** run a one-shot sketch (code goes in setup) and return its printed lines */
function setupOut(body: string, spec: McuBoardSpec = avr, globals = ''): string[] {
  const r = rig(`${globals}\nvoid setup(){ Serial.begin(9600); ${body} }\nvoid loop(){}`, spec);
  r.run(0.01);
  expect(r.rt.halted()).toBeNull();
  return lines(r);
}
const errs = (src: string, spec = avr) => new SketchRuntime(spec).load(src).diagnostics.filter((d) => d.severity === 'error');

describe('Blink and simulated time', () => {
  const src = `
void setup() { pinMode(LED_BUILTIN, OUTPUT); }
void loop() { digitalWrite(LED_BUILTIN, HIGH); delay(500); digitalWrite(LED_BUILTIN, LOW); delay(500); }`;
  it('toggles at 0.5 s boundaries of simTime', () => {
    const r = rig(src);
    const sample = (t: number): boolean | undefined => {
      r.run(t);
      return r.rt.drives(t).get('D13')?.high;
    };
    expect(r.rt.drives(0).size).toBe(0);
    expect(sample(0.1)).toBe(true);
    expect(sample(0.49)).toBe(true);
    expect(sample(0.51)).toBe(false);
    expect(sample(0.99)).toBe(false);
    expect(sample(1.01)).toBe(true);
    expect(sample(1.49)).toBe(true);
    expect(sample(1.51)).toBe(false);
    expect(r.rt.drives(1.51).get('D13')?.mode).toBe('out');
  });
  it('is insensitive to the advance step size', () => {
    const a = rig(src);
    const b = rig(src);
    a.run(0.75, a.h, 0.0005);
    b.run(0.75, b.h, 0.05);
    expect(a.rt.drives(0.75).get('D13')?.high).toBe(false);
    expect(b.rt.drives(0.75).get('D13')?.high).toBe(false);
  });
  it('reset() restarts setup()', () => {
    const r = rig('void setup(){ Serial.println("S"); } void loop(){ delay(100); }');
    r.run(0.5);
    expect(lines(r)).toEqual(['S']);
    r.rt.reset();
    r.run(0.5);
    expect(lines(r)).toEqual(['S', 'S']);
    expect(r.rt.drives(0).size).toBe(0);
  });
});

describe('digital input', () => {
  const src = `
void setup(){ Serial.begin(9600); pinMode(2, INPUT_PULLUP); }
void loop(){ Serial.println(digitalRead(2)); delay(10); }`;
  it('threshold with hysteresis', () => {
    const r = rig(src);
    const last = () => lines(r).at(-1);
    const set = (v: number, t: number) => {
      r.h = host({ D2: v });
      r.run(t, r.h);
    };
    set(5, 0.05);
    expect(last()).toBe('1');
    set(2.0, 0.1); // between 0.3 and 0.6 vcc: keep HIGH
    expect(last()).toBe('1');
    set(1.0, 0.15);
    expect(last()).toBe('0');
    set(2.0, 0.2); // keep LOW
    expect(last()).toBe('0');
    set(3.2, 0.25);
    expect(last()).toBe('1');
    expect(r.rt.drives(0.25).get('D2')).toEqual({ mode: 'pullup', high: false });
    expect(r.rt.gpio(0.25).find((g) => g.pin === 'D2')?.mode).toBe('pullup');
  });
  it('digitalWrite on INPUT toggles the pull-up (AVR)', () => {
    const r = rig(`void setup(){ pinMode(2, INPUT); digitalWrite(2, HIGH); pinMode(3, INPUT); } void loop(){}`);
    r.run(0.01);
    expect(r.rt.drives(0.01).get('D2')?.mode).toBe('pullup');
    expect(r.rt.drives(0.01).get('D3')?.mode).toBe('in');
    const r2 = rig(`void setup(){ pinMode(2, INPUT); digitalWrite(2, HIGH); digitalWrite(2, LOW); } void loop(){}`);
    r2.run(0.01);
    expect(r2.rt.drives(0.01).get('D2')?.mode).toBe('in');
  });
  it('warns about unknown pins and input-only pins', () => {
    const r = rig('void setup(){ pinMode(99, OUTPUT); digitalWrite(99, HIGH); } void loop(){}');
    r.run(0.01);
    expect(r.rt.warnings().some((w) => w.includes('Pin 99'))).toBe(true);
    expect(r.rt.halted()).toBeNull();
    const e = rig('void setup(){ pinMode(34, OUTPUT); } void loop(){}', esp);
    e.run(0.01);
    expect(e.rt.warnings().some((w) => w.includes('GPIO34'))).toBe(true);
    expect(e.rt.drives(0.01).get('G34')?.mode).toBe('in');
  });
});

describe('analog', () => {
  it('analogRead follows floor(V/vref*(2^bits-1))', () => {
    const r = rig(
      `void setup(){ Serial.begin(9600); Serial.println(analogRead(A0)); Serial.println(analogRead(0)); Serial.println(analogRead(A1)); analogReadResolution(12); Serial.println(analogRead(A0)); } void loop(){}`,
      avr,
      { A0: 2.5, A1: 9 },
    );
    r.run(0.01);
    expect(lines(r)).toEqual(['511', '511', '1023', '2047']);
  });
  it('analogWrite makes a real PWM square wave at pwmHz', () => {
    const r = rig('void setup(){ analogWrite(9, 128); analogWrite(4, 200); analogWrite(5, 0); analogWrite(6, 255); } void loop(){}');
    r.run(0.01);
    const g9 = r.rt.gpio(0.01).find((g) => g.pin === 'D9')!;
    expect(g9.mode).toBe('pwm');
    expect(g9.duty).toBeCloseTo(128 / 255, 6);
    const period = 1 / 490;
    let high = 0;
    let edges = 0;
    let prev = false;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const t = 0.01 + (i / N) * period;
      const hi = r.rt.drives(t).get('D9')!.high;
      if (hi) high++;
      if (hi && !prev) edges++;
      prev = hi;
    }
    expect(high / N).toBeCloseTo(128 / 255, 2);
    expect(edges).toBeLessThanOrEqual(2);
    // gpio().high agrees with drives()
    expect(r.rt.gpio(0.01 + 0.2 * period).find((g) => g.pin === 'D9')!.high).toBe(true);
    expect(r.rt.gpio(0.01 + 0.9 * period).find((g) => g.pin === 'D9')!.high).toBe(false);
    // 0 and 255 are steady levels, non-PWM pin is digital on AVR
    expect(r.rt.drives(0.0123).get('D5')).toEqual({ mode: 'out', high: false });
    expect(r.rt.drives(0.0123).get('D6')).toEqual({ mode: 'out', high: true });
    expect(r.rt.drives(0.0123).get('D4')).toEqual({ mode: 'out', high: true });
  });
  it('analogWriteResolution scales duty', () => {
    const r = rig('void setup(){ analogWriteResolution(10); analogWrite(9, 256); } void loop(){}');
    r.run(0.01);
    expect(r.rt.gpio(0.01).find((g) => g.pin === 'D9')!.duty).toBeCloseTo(256 / 1023, 6);
  });
  it('tone() produces a square wave of that frequency and stops after duration', () => {
    const r = rig('void setup(){ tone(8, 1000, 20); } void loop(){}');
    r.run(0.005);
    let rising = 0;
    let prev = false;
    for (let t = 0.001; t < 0.011; t += 0.00001) {
      const hi = r.rt.drives(t).get('D8')!.high;
      if (hi && !prev) rising++;
      prev = hi;
    }
    expect(rising).toBeGreaterThanOrEqual(9);
    expect(rising).toBeLessThanOrEqual(11);
    expect(r.rt.drives(0.05).get('D8')!.high).toBe(false);
    const r2 = rig('void setup(){ tone(8, 500); delay(10); noTone(8); } void loop(){}');
    r2.run(0.05);
    expect(r2.rt.drives(0.04).get('D8')!.high).toBe(false);
  });
});

describe('Serial output and formatting', () => {
  it('prints numbers, floats, bases, chars, strings, bools', () => {
    expect(
      setupOut(`
        Serial.println(42); Serial.println(-7); Serial.println(3.14159); Serial.println(3.14159, 4);
        Serial.println(255, HEX); Serial.println(10, BIN); Serial.println(8, OCT); Serial.println(-1, HEX);
        Serial.println('A'); Serial.println("hi"); Serial.println(F("flash")); Serial.println(true);
        Serial.print("a"); Serial.print(1); Serial.print('c'); Serial.println();
        Serial.println(2.0f); Serial.println(1.0/3);
      `),
    ).toEqual(['42', '-7', '3.14', '3.1416', 'FF', '1010', '10', 'FFFFFFFF', 'A', 'hi', 'flash', '1', 'a1c', '2.00', '0.33']);
  });
  it('println ends with CRLF', () => {
    const r = rig('void setup(){ Serial.println("x"); Serial.print("y"); } void loop(){}');
    r.run(0.01);
    expect(r.out).toEqual(['x\r\n', 'y']);
  });
  it('Serial input: available/read/readString/parseInt', () => {
    const r = rig(`void setup(){ Serial.begin(9600); } void loop(){
      if (Serial.available() > 0) { int n = Serial.parseInt(); Serial.println(n * 2); Serial.println(Serial.read()); }
      delay(5); }`);
    r.run(0.02);
    expect(r.text()).toBe('');
    r.rt.serialWrite('21;');
    r.run(0.04);
    expect(lines(r)).toEqual(['42', '59']); // ';' = 59
    const r2 = rig('void setup(){ Serial.println(Serial.read()); } void loop(){}');
    r2.run(0.01);
    expect(lines(r2)).toEqual(['-1']);
    const r3 = rig('void setup(){} void loop(){ if (Serial.available()) { String s = Serial.readString(); Serial.println(s.length()); } delay(1); }');
    r3.rt.serialWrite('hello');
    r3.run(0.01);
    expect(lines(r3)).toEqual(['5']);
  });
  it('Serial.printf exists on esp32 only', () => {
    expect(setupOut('Serial.printf("%d-%s-%.1f-%x-%c%%", 7, "ab", 2.55, 255, 65);', esp)).toEqual(['7-ab-2.5-ff-A%'].map((s) => s));
    expect(errs('void setup(){ Serial.printf("x"); } void loop(){}')[0].message).toContain('printf');
  });
});

describe('types and arithmetic', () => {
  it('int wraps to 16 bits on AVR, 32 bits on ESP', () => {
    const body = `int x = 32767; x = x + 1; Serial.println(x);
      int p = 300 * 300; Serial.println(p);
      long q = 300L * 300; Serial.println(q);
      unsigned int u = 0; u--; Serial.println(u);
      byte b = 255; b++; Serial.println(b);
      unsigned long ul = 0; ul--; Serial.println(ul);
      long big = 2147483647; big++; Serial.println(big);
      int8_t i8 = 127; i8++; Serial.println(i8);
      int sh = 1 << 15; Serial.println(sh);`;
    expect(setupOut(body, avr)).toEqual(['-32768', '24464', '90000', '65535', '0', '4294967295', '-2147483648', '-128', '-32768']);
    expect(setupOut(body, esp)).toEqual(['32768', '90000', '90000', '4294967295', '0', '4294967295', '-2147483648', '-128', '32768']);
  });
  it('integer vs float division', () => {
    expect(setupOut('int i = 7; float a = i / 2; float b = i / 2.0; float c = (float)i / 2; Serial.println(7 / 2); Serial.println(-7 / 2); Serial.println(-7 % 3); Serial.println(a); Serial.println(b); Serial.println(c); Serial.println(int(3.99)); Serial.println(int(-3.99));')).toEqual(['3', '-3', '-1', '3.00', '3.50', '3.50', '3', '-3']);
  });
  it('float uses single precision', () => {
    expect(setupOut('float f = 0.1; Serial.println(f * 3, 6); float g = 16777216.0; g = g + 1; Serial.println(g, 0);')).toEqual(['0.300000', '16777216']);
  });
  it('assignment coerces to declared type', () => {
    expect(setupOut('byte b = 300; int i = 3.9; bool t = 5; char c = 65; float f = 5; Serial.println(b); Serial.println(i); Serial.println(t); Serial.println(c); Serial.println(f);')).toEqual(['44', '3', '1', 'A', '5.00']);
  });
  it('bit operators, ternary, compound assignment, literals', () => {
    expect(
      setupOut(`Serial.println(0b1010 | 0x01); Serial.println(5 & 3); Serial.println(5 ^ 1); Serial.println(~5); Serial.println(1 << 3); Serial.println(256 >> 2);
        int x = 10; x += 5; x -= 3; x *= 2; x /= 5; x %= 3; Serial.println(x);
        x = 6; x <<= 2; x |= 1; x &= 0x1F; x ^= 3; x >>= 1; Serial.println(x);
        Serial.println(x > 5 ? 100 : 200); Serial.println(017); Serial.println(1e3); Serial.println(2.5e-1);
        Serial.println(70000UL); Serial.println(!0); Serial.println(!5); Serial.println(1 && 0); Serial.println(1 || 0);`),
    ).toEqual(['11', '1', '4', '-6', '8', '64', '1', '13', '100', '15', '1000.00', '0.25', '70000', '1', '0', '0', '1']);
  });
  it('division by zero warns and yields 0', () => {
    const r = rig('void setup(){ int z = 0; Serial.println(5 / z); Serial.println(5 % z); float f = 1.0 / z; Serial.println(f); } void loop(){}');
    r.run(0.01);
    expect(lines(r)).toEqual(['0', '0', '0.00']);
    expect(r.rt.warnings().some((w) => w.includes('Sıfıra bölme'))).toBe(true);
    expect(r.rt.halted()).toBeNull();
  });
  it('Arduino math helpers', () => {
    expect(
      setupOut(`Serial.println(abs(-5)); Serial.println(min(3, 7)); Serial.println(max(3, 7.5)); Serial.println(constrain(150, 0, 100));
        Serial.println(map(512, 0, 1023, 0, 255)); Serial.println(pow(2, 10), 0); Serial.println(sqrt(144.0), 1); Serial.println(round(2.5)); Serial.println(round(-2.5));
        Serial.println(floor(2.7), 1); Serial.println(sq(7)); Serial.println(lowByte(0x1234), HEX); Serial.println(highByte(0x1234), HEX);
        int v = 0; bitSet(v, 3); bitWrite(v, 0, 1); Serial.println(v); bitClear(v, 3); Serial.println(v); Serial.println(bitRead(5, 2)); Serial.println(PI, 3);
        Serial.println(sin(HALF_PI), 2); Serial.println(sizeof(int)); Serial.println(isDigit('7'));`),
    ).toEqual(['5', '3', '7.50', '100', '127', '1024', '12.0', '3', '-3', '2.0', '49', '34', '12', '9', '1', '1', '3.142', '1.00', '2', '1']);
  });
  it('random is deterministic and in range', () => {
    const body = 'randomSeed(7); for (int i = 0; i < 20; i++) { Serial.println(random(10)); Serial.println(random(5, 8)); }';
    const a = setupOut(body);
    expect(setupOut(body)).toEqual(a);
    for (let i = 0; i < a.length; i += 2) {
      expect(+a[i]).toBeGreaterThanOrEqual(0);
      expect(+a[i]).toBeLessThan(10);
      expect(+a[i + 1]).toBeGreaterThanOrEqual(5);
      expect(+a[i + 1]).toBeLessThan(8);
    }
    expect(new Set(a).size).toBeGreaterThan(3);
  });
});

describe('control flow, functions, arrays', () => {
  it('switch / for / while / do-while / break / continue', () => {
    expect(
      setupOut(`
        for (int i = 0; i < 6; i++) { switch (i) { case 0: Serial.print("z"); break; case 1: case 2: Serial.print("t"); case 3: Serial.print("f"); break; default: Serial.print("d"); } }
        Serial.println();
        int s = 0; for (int i = 1; i <= 10; i++) { if (i % 2) continue; if (i > 8) break; s += i; } Serial.println(s);
        int n = 0; while (n < 5) n++; Serial.println(n);
        int m = 10; do { m++; } while (m < 5); Serial.println(m);
        for (int i = 0, j = 10; i < j; i += 3, j -= 3) Serial.print(i + j); Serial.println();
        switch ('b') { case 'a': Serial.println("A"); break; case 'b': Serial.println("B"); break; }
      `),
    ).toEqual(['ztftffdd', '20', '5', '11', '1010', 'B']);
  });
  it('functions: parameters, return, forward declaration, recursion, static locals, array params', () => {
    expect(
      setupOut(
        `Serial.println(fact(5)); Serial.println(fib(15)); Serial.println(add(2, 3.7)); Serial.println(counter()); Serial.println(counter()); Serial.println(counter());
         int a[4] = {4, 3, 2, 1}; Serial.println(sum(a, 4)); fill(a, 9); Serial.println(a[0] + a[3]); Serial.println(greet("bob"));`,
        avr,
        `int add(int a, int b);
         long fact(int n) { if (n <= 1) return 1; return n * fact(n - 1); }
         int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
         int add(int a, int b) { return a + b; }
         int counter() { static int c = 0; c++; return c; }
         int sum(int v[], int n) { int s = 0; for (int i = 0; i < n; i++) s += v[i]; return s; }
         void fill(int v[], int x) { v[0] = x; v[3] = x; }
         String greet(String n) { return "hi " + n; }`,
      ),
    ).toEqual(['120', '610', '5', '1', '2', '3', '10', '18', 'hi bob']);
  });
  it('arrays: initializers, sizes, #define constants, out-of-range warns instead of crashing', () => {
    const r = rig(`
      #define N 4
      const int M = N * 2;
      int a[N] = {1, 2, 3};
      int b[] = {5, 6, 7};
      char name[] = "abc";
      float f[M];
      void setup() {
        Serial.begin(9600);
        a[3] = 10;
        Serial.println(a[0] + a[1] + a[2] + a[3]);
        Serial.println(sizeof(b) / sizeof(b[0]));
        Serial.println(name); Serial.println(sizeof(name));
        f[7] = 1.5; Serial.println(f[7]);
        Serial.println(a[10]);
        a[-1] = 5;
        for (int i = 0; i < N; i++) a[i]++;
        Serial.println(a[3]);
        int k = 0; a[k++] = 99; Serial.println(k);
      }
      void loop() {}`);
    r.run(0.01);
    expect(lines(r)).toEqual(['16', '3', 'abc', '4', '1.50', '0', '11', '1']);
    expect(r.rt.warnings().filter((w) => w.includes('sınır dışı')).length).toBe(2);
    expect(r.rt.halted()).toBeNull();
  });
  it('#define and #ifdef', () => {
    expect(
      setupOut(
        'Serial.println(LED); Serial.println(TWICE); Serial.println(SCALE);\n#ifdef DEBUG\nSerial.println("dbg");\n#else\nSerial.println("nodbg");\n#endif\n#ifndef NOPE\nSerial.println("yes");\n#endif\n',
        avr,
        '#define LED 13\n#define DEBUG_OFF\n#define TWICE (LED * 2)\n#define SCALE 2.5',
      ),
    ).toEqual(['13', '26', '2.50', 'nodbg', 'yes']);
  });
  it('infinite recursion halts the program with a message', () => {
    const r = rig('void f(){ f(); } void setup(){ f(); } void loop(){}');
    r.run(0.01);
    expect(r.rt.halted()).toContain('Yığın');
  });
});

describe('String', () => {
  it('concatenation, comparison and methods', () => {
    expect(
      setupOut(`
        String a = "foo"; String b = a + "bar" + 1 + 'c' + 2.5; Serial.println(b);
        Serial.println(b.length()); Serial.println(b.charAt(3)); Serial.println(b.substring(3, 6)); Serial.println(b.indexOf("bar")); Serial.println(b.indexOf('z'));
        Serial.println(a == "foo"); Serial.println(a != "foo"); Serial.println(a.equals("foo")); Serial.println(a < "goo");
        String n = "  42  "; n.trim(); Serial.println(n.toInt() + 1); Serial.println(String("3.5").toFloat() * 2);
        String u = "MiXed"; u.toUpperCase(); Serial.println(u); u.toLowerCase(); Serial.println(u);
        String s = String(12) + String(255, HEX) + String(1.5) + String('x'); Serial.println(s);
        s = ""; for (int i = 0; i < 3; i++) s += i; Serial.println(s);
        Serial.println(s[1]); Serial.println(a.startsWith("fo")); u.replace("x", "-"); Serial.println(u);
      `),
    ).toEqual(['foobar1c2.50', '12', 'b', 'bar', '3', '-1', '1', '0', '1', '1', '43', '7.00', 'MIXED', 'mixed', '12FF1.50x', '012', '1', '1', 'mi-ed']);
  });
});

describe('time model', () => {
  it('millis() follows simulated time', () => {
    const r = rig('void setup(){ Serial.begin(9600); } void loop(){ delay(100); Serial.println(millis()); }');
    r.run(0.55);
    const v = lines(r).map(Number);
    expect(v.length).toBe(5);
    v.forEach((m, i) => {
      expect(m).toBeGreaterThanOrEqual((i + 1) * 100);
      expect(m).toBeLessThan((i + 1) * 100 + 1);
    });
    const r2 = rig('void setup(){ Serial.begin(9600); delay(250); Serial.println(micros() / 1000); } void loop(){}');
    r2.run(0.4);
    expect(Math.trunc(+lines(r2)[0])).toBe(250);
  });
  it('millis() busy-wait loop terminates in simulated time', () => {
    const r = rig('void setup(){ Serial.begin(9600); unsigned long t0 = millis(); while (millis() - t0 < 50) {} Serial.println("done"); } void loop(){}');
    r.run(0.3, r.h, 0.01);
    expect(lines(r)).toEqual(['done']);
  });
  it('a sketch that never delays does not hang advance()', () => {
    for (const src of ['void setup(){ while(1){} } void loop(){}', 'void setup(){ while(1); } void loop(){}', 'void setup(){} void loop(){ int x = 0; x++; }', 'void setup(){ for(;;); } void loop(){}']) {
      const r = rig(src);
      const t0 = Date.now();
      for (let t = 0.016; t < 0.5; t += 0.016) r.rt.advance(t, r.h);
      expect(Date.now() - t0).toBeLessThan(3000);
      expect(r.rt.halted()).toBeNull();
    }
  });
  it('delay() inside a called function resumes correctly', () => {
    const r = rig('void tick(){ delay(100); Serial.print("t"); } void setup(){} void loop(){ tick(); tick(); Serial.println(); }');
    r.run(0.45);
    expect(lines(r)).toEqual(['tt', 'tt']);
  });
});

describe('diagnostics', () => {
  it('unsupported constructs give Turkish errors with line numbers', () => {
    const cases: [string, number, string][] = [
      ['void setup(){}\nvoid loop(){}\nstruct P { int x; };', 3, 'struct'],
      ['void setup(){}\nvoid loop(){}\nclass A {};', 3, 'class'],
      ['enum Color { RED };\nvoid setup(){}\nvoid loop(){}', 1, 'enum'],
      ['typedef int myint;\nvoid setup(){}\nvoid loop(){}', 1, 'typedef'],
      ['void setup(){}\nvoid loop(){\n int *p;\n}', 3, 'işaretçi'],
      ['void setup(){}\nvoid loop(){\n int x = 1;\n int y = *x;\n}', 4, 'işaretçi'],
      ['void setup(){}\nvoid loop(){\n int x = 1;\n int* p = &x;\n}', 4, 'işaretçi'],
      ['void f(int &r){}\nvoid setup(){}\nvoid loop(){}', 1, 'referans'],
      ['void setup(){}\nvoid loop(){\n int *p = new int;\n}', 3, 'new'],
      ['void setup(){}\nvoid loop(){\n a:\n goto a;\n}', 4, 'goto'],
      ['void setup(){}\nvoid loop(){\n auto f = [](int x){ return x; };\n}', 3, 'auto'],
      ['void setup(){}\nvoid loop(){\n int x = 1;\n x = [](){ return 1; }();\n}', 4, 'lambda'],
      ['template <typename T> T id(T x){ return x; }\nvoid setup(){}\nvoid loop(){}', 1, 'template'],
      ['void setup(){}\nvoid loop(){\n int m[2][2];\n}', 3, 'çok boyutlu'],
      ['void setup(){}\nvoid loop(){\n long long z = 1;\n}', 3, 'long long'],
      ['#define SQ(x) x*x\nvoid setup(){}\nvoid loop(){}', 1, 'makro'],
      ['void setup(){}\nvoid loop(){\n LiquidCrystal lcd;\n}', 3, 'LiquidCrystal'],
    ];
    for (const [src, line, word] of cases) {
      const e = errs(src);
      expect(e.length, src).toBeGreaterThan(0);
      expect(e[0].line, `${src} -> ${e[0].message}`).toBe(line);
      expect(e[0].message.toLowerCase(), src).toContain(word.toLowerCase());
    }
  });
  it('syntax errors, undeclared names, argument counts, missing setup/loop, bad types', () => {
    expect(errs('void setup(){}\nvoid loop(){\n int x = ;\n}')[0].line).toBe(3);
    expect(errs('void setup(){}\nvoid loop(){\n int x = 3\n}')[0].line).toBe(4);
    const u = errs('void setup(){}\nvoid loop(){\n foo = 5;\n}');
    expect(u[0]).toMatchObject({ line: 3, severity: 'error' });
    expect(u[0].message).toContain("'foo'");
    expect(errs('void setup(){}\nvoid loop(){\n digitalWrite(13);\n}')[0]).toMatchObject({ line: 3 });
    expect(errs('void setup(){}\nvoid loop(){\n delay(1, 2);\n}')[0].message).toContain('delay()');
    expect(errs('void setup(){}\nvoid loop(){\n bar(1);\n}')[0].message).toContain("'bar'");
    expect(errs('int f(int a){ return a; }\nvoid setup(){}\nvoid loop(){\n f(1, 2);\n}')[0]).toMatchObject({ line: 4 });
    expect(errs('void setup(){}').some((d) => d.message.includes('loop()'))).toBe(true);
    expect(errs('void loop(){}').some((d) => d.message.includes('setup()'))).toBe(true);
    expect(errs('void setup(){}\nvoid loop(){\n int x = "abc";\n}')[0].line).toBe(3);
    expect(errs('void setup(){}\nvoid loop(){\n String s = 5;\n}')[0].line).toBe(3);
    expect(errs('void setup(){}\nvoid loop(){\n break;\n}')[0].line).toBe(3);
    expect(errs('void setup(){}\nvoid loop(){\n int x; int x;\n}')[0].line).toBe(3);
    expect(errs('void setup(){}\nvoid loop(){\n const int k = 1; k = 2;\n}')[0].line).toBe(3);
    expect(errs('void setup(){}\nvoid loop(){\n float f = 1.5; int r = f % 2;\n}')[0].line).toBe(3);
    expect(errs('void setup(){}\nvoid loop(){\n Serial.println("a" + "b");\n}')[0].line).toBe(3);
    expect(errs('void setup(){}\nvoid loop(){\n Serial.foo(1);\n}')[0].message).toContain('foo');
    expect(errs('void setup(){}\nvoid loop(){\n char *s = "x";\n}')[0].message).toContain('işaretçi');
  });
  it('never throws on garbage and reports ok=false', () => {
    const rt = new SketchRuntime(avr);
    for (const src of ['', '}{', 'int', 'void setup(', '"unterminated', '@@@', '#include', 'int x = 0x;', "char c = 'ab';", '#if 1\n#endif']) {
      const r = rt.load(src);
      expect(r.ok).toBe(false);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
    rt.advance(1, host());
    expect(rt.halted()).toBeNull();
  });
  it('a valid program loads ok with no errors', () => {
    const r = new SketchRuntime(avr).load('void setup(){} void loop(){}');
    expect(r).toEqual({ ok: true, diagnostics: [] });
  });
  it('code text cannot inject JavaScript', () => {
    const r = rig(String.raw`void setup(){ Serial.println("q\"); process.exit(); //"); } void loop(){}`);
    r.run(0.01);
    expect(lines(r)).toEqual(['q"); process.exit(); //']);
    const e = errs('void setup(){ int a = 1; a.constructor(); } void loop(){}');
    expect(e.length).toBeGreaterThan(0);
    expect(errs('int v_x; void setup(){ int constructor = 1; $ = 2; } void loop(){}').length).toBeGreaterThan(0);
  });
});

describe('unmodelled peripherals', () => {
  it('Servo/Serial1/pulseIn stay no-ops with a deduplicated warning; Wire/SPI/interrupts are modelled now', () => {
    const src = `#include <Wire.h>\n#include <SPI.h>\n#include <Servo.h>\nServo s;\nvoid isr(){}\nvoid setup(){ Wire.begin(); Wire.beginTransmission(8); Wire.write(1); Wire.endTransmission(); s.attach(9); s.write(90); attachInterrupt(digitalPinToInterrupt(2), isr, FALLING); Serial1.begin(9600); SPI.begin(); Serial.println(pulseIn(2, HIGH)); } void loop(){}`;
    const rt = new SketchRuntime(avr);
    const res = rt.load(src);
    expect(res.ok).toBe(true);
    const ws = res.diagnostics.filter((d) => d.severity === 'warning');
    expect(ws.map((w) => w.line)).toEqual([3]);
    expect(ws[0].message).toContain('WiFi/Servo modeli yok');
    const out: string[] = [];
    rt.onSerial = (t) => out.push(t);
    for (let t = 0.001; t < 0.01; t += 0.001) rt.advance(t, host());
    expect(out.join('')).toBe('0\r\n');
    const w = rt.warnings();
    expect(w.some((x) => x.startsWith('Servo'))).toBe(true);
    expect(w.some((x) => x.startsWith('Serial1'))).toBe(true);
    expect(w.some((x) => x.startsWith('pulseIn'))).toBe(true);
    // Wire/SPI/attachInterrupt no longer produce "model yok" warnings (no bus attached => one explicit bus warning)
    expect(w.some((x) => x.includes('modeli yok') && /Wire|SPI|attachInterrupt/.test(x))).toBe(false);
    expect(w.filter((x) => x.startsWith('I2C:'))).toHaveLength(1);
    expect(new Set(w).size).toBe(w.length);
    expect(rt.halted()).toBeNull();
  });
});

describe('gpio()', () => {
  it('lists every board pin with its mode', () => {
    const r = rig('void setup(){ pinMode(13, OUTPUT); digitalWrite(13, HIGH); pinMode(2, INPUT); analogWrite(9, 100); } void loop(){}');
    r.run(0.01);
    const g = r.rt.gpio(0.01);
    expect(g.map((x) => x.num)).toEqual(Object.keys(avr.pinMap).map(Number).sort((a, b) => a - b));
    const by = (p: string) => g.find((x) => x.pin === p)!;
    expect(by('D13')).toMatchObject({ mode: 'out', high: true, num: 13 });
    expect(by('D2').mode).toBe('in');
    expect(by('D9').mode).toBe('pwm');
    expect(by('D10').mode).toBe('unconfigured');
  });
  it('ESP32 analogWrite on a non-PWM pin warns, input pins read with host voltage', () => {
    const r = rig('void setup(){ pinMode(35, INPUT); analogWrite(35, 200); Serial.println(analogRead(35)); } void loop(){}', esp, { G35: 1.65 });
    r.run(0.01);
    expect(lines(r)).toEqual(['2047']);
  });
});
