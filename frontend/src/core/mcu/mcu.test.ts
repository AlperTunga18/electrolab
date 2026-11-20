import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit/builder';
import { Sim } from '../sim/mna';
import { checkStress } from '../sim/stress';
import { getDef } from '../../library/components';
import { COMPAT, MCU_BOARD_IDS, PERIPHERALS } from './boards';

const spec = (id: string) => getDef(id).mcu!;

function ledCircuit(board = 'mod_arduino_uno_r3', pin = 'D13/SCK', r = 220) {
  const b = new CircuitBuilder();
  b.add(board, {}, 0, 0, 0, 'U1');
  b.add('resistor', { r }); b.add('led', { color: 'red' }); b.add('ground');
  b.chain(`U1.${pin}`, 'R1.1'); b.chain('R1.2', 'D1.A'); b.chain('D1.K', 'U1.GND'); b.chain('U1.GND', 'GND1.G');
  return b.circuit;
}

describe('MCU boards in the library', () => {
  it('supported boards are upgraded to the mcu model with consistent specs', () => {
    expect(MCU_BOARD_IDS.length).toBe(5);
    for (const id of MCU_BOARD_IDS) {
      const d = getDef(id);
      expect(d.model).toBe('mcu');
      const s = d.mcu!;
      const ids = new Set(d.pins.map((p) => p.id));
      for (const pin of Object.values(s.pinMap)) expect(ids.has(pin), `${id}:${pin}`).toBe(true);
      for (const sp of s.supplies) expect(ids.has(sp.pin), `${id} supply ${sp.pin}`).toBe(true);
      expect(s.gnd.length).toBeGreaterThan(0);
      for (const g of s.gnd) expect(ids.has(g)).toBe(true);
    }
    expect(spec('mod_arduino_uno_r3').vcc).toBe(5);
    expect(spec('mod_esp32_devkit_v1').vcc).toBe(3.3);
    expect(spec('mod_esp32_devkit_v1').inputOnly).toEqual(expect.arrayContaining([34, 35, 36, 39]));
    expect(spec('mod_raspberry_pi_pico').adcPins).toEqual([26, 27, 28]);
  });
  it('compatibility matrix rows match the peripheral list', () => {
    for (const b of COMPAT) expect(b.cells.length).toBe(PERIPHERALS.length);
  });
});

describe('MCU electrical model (Thevenin GPIO)', () => {
  it('output HIGH drives the LED through rOut; LOW sinks; input is high impedance', () => {
    const sim = new Sim(ledCircuit());
    const s = spec('mod_arduino_uno_r3');
    sim.setPinDrive('U1', 'D13/SCK', { mode: 'out', high: true }, s);
    sim.solveDC();
    const r = sim.results();
    // I = (5 - Vf) / (220 + 40) with Vf ~1.9 V -> ~12 mA
    expect(r.D1.i).toBeGreaterThan(0.010);
    expect(r.D1.i).toBeLessThan(0.014);
    const pinV = sim.pinVoltage('U1', 'D13/SCK');
    expect(pinV).toBeGreaterThan(4.4); expect(pinV).toBeLessThan(4.9);
    expect(r.U1.vals['i_D13/SCK']).toBeCloseTo(r.D1.i, 6);

    sim.setPinDrive('U1', 'D13/SCK', { mode: 'out', high: false }, s);
    sim.solveDC();
    expect(Math.abs(sim.results().D1.i)).toBeLessThan(1e-6);

    sim.setPinDrive('U1', 'D13/SCK', { mode: 'in', high: false }, s);
    sim.solveDC();
    expect(Math.abs(sim.results().U1.vals['i_D13/SCK'])).toBeLessThan(1e-6);
  });

  it('INPUT_PULLUP: ~35 kohm to VCC; a switch to GND pulls the pin low', () => {
    const b = new CircuitBuilder();
    b.add('mod_arduino_uno_r3', {}, 0, 0, 0, 'U1'); b.add('switch', { closed: false }); b.add('ground');
    b.chain('U1.D2', 'SW1.1'); b.chain('SW1.2', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
    const s = spec('mod_arduino_uno_r3');
    const sim = new Sim(b.circuit);
    sim.setPinDrive('U1', 'D2', { mode: 'pullup', high: false }, s);
    sim.solveDC();
    expect(sim.pinVoltage('U1', 'D2')).toBeGreaterThan(4.9);
    b.circuit.components.find((c) => c.id === 'SW1')!.params.closed = true;
    const sim2 = new Sim(b.circuit);
    sim2.setPinDrive('U1', 'D2', { mode: 'pullup', high: false }, s);
    sim2.solveDC();
    expect(sim2.pinVoltage('U1', 'D2')).toBeLessThan(0.01);
  });

  it('5V pin is a supply (USB); ESP32 3V3 pin supplies 3.3 V; all GND pins are tied together', () => {
    const b = new CircuitBuilder();
    b.add('mod_esp32_devkit_v1', {}, 0, 0, 0, 'U1'); b.add('resistor', { r: 330 }); b.add('ground');
    b.chain('U1.3V3', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
    const sim = new Sim(b.circuit);
    sim.solveDC();
    const r = sim.results();
    expect(sim.pinVoltage('U1', '3V3')).toBeGreaterThan(3.29);
    expect(r.R1.i).toBeGreaterThan(0.0099);
    // the second GND pin is internally tied to the first one
    expect(Math.abs(sim.pinVoltage('U1', 'GND_2'))).toBeLessThan(1e-6);
  });

  it('GPIO overcurrent and overvoltage are reported by the stress check', () => {
    // GPIO driven HIGH straight into a 10 ohm load: ~ (5 V / 50 ohm) = 100 mA >> 40 mA
    const b = new CircuitBuilder();
    b.add('mod_arduino_uno_r3', {}, 0, 0, 0, 'U1'); b.add('resistor', { r: 10, pmax: 5 }); b.add('ground');
    b.chain('U1.D5', 'R1.1'); b.chain('R1.2', 'GND1.G'); b.chain('U1.GND', 'GND1.G');
    const sim = new Sim(b.circuit);
    sim.setPinDrive('U1', 'D5', { mode: 'out', high: true }, spec('mod_arduino_uno_r3'));
    sim.solveDC();
    const st = checkStress(b.circuit, sim.results());
    expect(st.some((x) => x.label === 'GPIO akımı')).toBe(true);

    // 5 V source on an ESP32 input pin
    const e = new CircuitBuilder();
    e.add('mod_esp32_devkit_v1', {}, 0, 0, 0, 'U1'); e.add('dc_supply', { v: 5 }); e.add('ground');
    e.chain('V1.P', 'U1.D4'); e.chain('V1.N', 'GND1.G'); e.chain('U1.GND', 'GND1.G');
    const s2 = new Sim(e.circuit);
    s2.solveDC();
    const st2 = checkStress(e.circuit, s2.results());
    expect(st2.some((x) => x.label === 'GPIO gerilimi' && x.value > 4.9)).toBe(true);
  });

  it('a killed (dead) pin stops driving', () => {
    const sim = new Sim(ledCircuit());
    const s = spec('mod_arduino_uno_r3');
    sim.killPin('U1', 'D13/SCK');
    sim.setPinDrive('U1', 'D13/SCK', { mode: 'out', high: true }, s);
    sim.solveDC();
    expect(Math.abs(sim.results().D1.i)).toBeLessThan(1e-6);
  });
});
