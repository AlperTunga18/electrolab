import { describe, expect, it } from 'vitest';
import type { McuBoardSpec, McuHost } from '../types';
import { AvrRuntime } from './AvrRuntime';
import blinkHex from './fixtures/blink.uno.hex?raw';

/**
 * Gerçek arduino-cli 1.6.0 (arduino:avr 1.8.8, Uno) ile derlenmiş Blink HEX'i.
 * Kaynak: void setup(){pinMode(13,OUTPUT);} void loop(){digitalWrite(13,HIGH);delay(500);digitalWrite(13,LOW);delay(500);}
 */
const pinMap: Record<number, string> = {};
for (let i = 0; i <= 13; i++) pinMap[i] = `D${i}`;
for (let i = 0; i < 6; i++) pinMap[14 + i] = `A${i}`;
const spec: McuBoardSpec = {
  family: 'avr', vcc: 5, intBits: 16, cpuHz: 16_000_000, adcBits: 10, adcVref: 5, pinMap, constants: {},
  pwmPins: [3, 5, 6, 9, 10, 11], pwmHz: 490, adcPins: [14, 15, 16, 17, 18, 19], inputOnly: [],
  rOutHigh: 25, rOutLow: 25, rPullup: 30000, imaxPin: 0.04, vInMargin: 0.5, supplies: [], gnd: [], notes: [],
};
const host: McuHost = { readVoltage: () => 0 };

describe('gerçek derlenmiş HEX', () => {
  it('Blink: D13 yaklaşık 1 Hz (500 ms açık / 500 ms kapalı) yanıp söner', () => {
    const rt = new AvrRuntime(spec);
    const r = rt.load(blinkHex);
    expect(r.ok).toBe(true);
    const edges: number[] = [];
    let last: boolean | null = null;
    for (let t = 0; t < 2.3; t += 0.001) {
      rt.advance(t, host);
      const d = rt.drives(t).get('D13');
      if (d && d.mode === 'out') {
        if (last !== null && d.high !== last) edges.push(t);
        last = d.high;
      }
    }
    expect(edges.length).toBeGreaterThanOrEqual(4);
    const half = edges[2] - edges[1];
    expect(half).toBeGreaterThan(0.48);
    expect(half).toBeLessThan(0.52);
  });
});
