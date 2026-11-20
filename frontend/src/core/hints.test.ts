import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from './circuit/builder';
import { liveHints } from './hints';
import { EXAMPLES } from '../examples/examples';

const codes = (c: ReturnType<CircuitBuilder['circuit']['valueOf']>) => liveHints(c as never).map((h) => h.code);

describe('liveHints', () => {
  it('good LED circuit has no errors/warnings', () => {
    const led = EXAMPLES.find((e) => e.id === 'led')!.build();
    const bad = liveHints(led).filter((h) => h.severity !== 'tip');
    expect(bad).toEqual([]);
  });

  it('LED straight across the source: no-resistor error', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }, -6, 0, 0, 'V1');
    b.add('led', { color: 'red' }, 4, -3);
    b.add('ground', {}, 0, 4);
    b.chain('V1.P', 'D1.A'); b.chain('D1.K', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    expect(codes(b.circuit)).toContain('LED_NO_RESISTOR');
  });

  it('reversed LED is flagged', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }, -6, 0, 0, 'V1');
    b.add('resistor', { r: 150 }, -1, -3);
    b.add('led', { color: 'red' }, 4, -3);
    b.add('ground', {}, 0, 4);
    b.chain('V1.P', 'R1.1'); b.chain('R1.2', 'D1.K'); b.chain('D1.A', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    expect(codes(b.circuit)).toContain('LED_REVERSED');
  });

  it('shorted source is an error (from ERC)', () => {
    const b = new CircuitBuilder();
    b.add('dc_supply', { v: 5 }, -6, 0, 0, 'V1');
    b.add('ground', {}, 0, 4);
    b.chain('V1.P', 'GND1.G'); b.chain('V1.N', 'GND1.G');
    expect(liveHints(b.circuit as never).some((h) => h.severity === 'error')).toBe(true);
  });

  it('empty circuit gives nothing', () => {
    expect(liveHints({ components: [], wires: [] } as never)).toEqual([]);
  });
});
