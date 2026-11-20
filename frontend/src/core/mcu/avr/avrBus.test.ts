import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../../circuit/builder';
import { Sim } from '../../sim/mna';
import { getDef } from '../../../library/components';
import { BusFabric } from '../bus';
import type { Circuit } from '../../circuit/types';
import { AvrRuntime } from './AvrRuntime';

/**
 * The avr8js TWI/SPI peripherals are driven register by register (no compiler in the repo), exactly the way avr-libc
 * Wire/SPI code does it, against a real netlist (Uno + bus devices) solved by the real Sim.
 */
const IDLE_HEX = ((): string => {
  const words = [0xcfff]; // rjmp .-1
  const bytes: number[] = [];
  for (const w of words) bytes.push(w & 0xff, (w >> 8) & 0xff);
  const rec = (addr: number, type: number, data: number[]): string => {
    const body = [data.length, (addr >> 8) & 0xff, addr & 0xff, type, ...data];
    const sum = body.reduce((a, b) => (a + b) & 0xff, 0);
    return ':' + [...body, -sum & 0xff].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  };
  return rec(0, 0, bytes) + '\n' + rec(0, 1, []) + '\n';
})();

const TWBR = 0xb8, TWSR = 0xb9, TWDR = 0xbb, TWCR = 0xbc;
const SPCR = 0x4c, SPSR = 0x4d, SPDR = 0x4e, DDRB = 0x24, PORTB = 0x25;
type Cpu = { data: Uint8Array; writeData(a: number, v: number): void };

function setup(c: Circuit) {
  const sim = new Sim(c, { init: 'ic', method: 'trap' });
  sim.init();
  const fab = new BusFabric(getDef);
  fab.setCircuit(c, { pinNet: (comp, pin) => sim.nets.pinNet.get(`${comp}:${pin}`), netVoltage: (n) => sim.nodeVoltage(n) });
  const spec = getDef('mod_arduino_uno_r3').mcu!;
  const rt = new AvrRuntime(spec);
  rt.setBus(fab.link('U1', spec));
  expect(rt.load(IDLE_HEX).ok).toBe(true);
  const cpu = (rt as unknown as { cpu: Cpu }).cpu;
  let t = 0;
  const host = { readVoltage: () => 0 };
  const step = (us = 3): void => { t += us * 1e-6; rt.advance(t, host); };
  return { rt, cpu, step, fab };
}

function twiCircuit(pullups: boolean, kind: 'busdev_tmp102' | 'busdev_24c02' = 'busdev_tmp102') {
  const b = new CircuitBuilder();
  b.add('mod_arduino_uno_r3', {}, 0, 0, 0, 'U1');
  b.add(kind, kind === 'busdev_tmp102' ? { temp: 21.5 } : { addr: 0x50 }, 4, 0, 0, 'S1');
  b.add('ground');
  b.chain('U1.GND', 'GND1.G');
  b.wire('U1.5V', 'S1.VCC'); b.wire('U1.GND', 'S1.GND');
  b.wire('U1.A4/SDA', 'S1.SDA'); b.wire('U1.A5/SCL', 'S1.SCL');
  if (pullups) {
    b.add('resistor', { r: 4700 }, 0, 0, 0, 'R1'); b.wire('U1.5V', 'R1.1'); b.wire('R1.2', 'S1.SDA');
    b.add('resistor', { r: 4700 }, 0, 0, 0, 'R2'); b.wire('U1.5V', 'R2.1'); b.wire('R2.2', 'S1.SCL');
  }
  return b.circuit;
}

const START = 0xa4, SEND = 0x84, STOP = 0x94, RECV_ACK = 0xc4, RECV_NACK = 0x84;

describe('AVR HEX runtime: TWI (I2C master) on the bus layer', () => {
  function master(r: ReturnType<typeof setup>) {
    return {
      op(ctl: number, data?: number): number {
        if (data !== undefined) r.cpu.writeData(TWDR, data);
        r.cpu.writeData(TWCR, ctl);
        r.step();
        return r.cpu.data[TWSR] & 0xf8;
      },
      get twdr(): number { return r.cpu.data[TWDR]; },
    };
  }
  it('with pull-ups: SLA+W is ACKed (0x18); reads the TMP102 temperature register through the real TWI state machine', () => {
    const r = setup(twiCircuit(true));
    const m = master(r);
    r.cpu.data[TWBR] = 72;
    expect(m.op(START)).toBe(0x08);
    expect(m.op(SEND, 0x48 << 1)).toBe(0x18);
    expect(m.op(SEND, 0x00)).toBe(0x28);                   // pointer = temperature
    expect(m.op(START)).toBe(0x10);                        // repeated start
    expect(m.op(SEND, (0x48 << 1) | 1)).toBe(0x40);        // SLA+R ACK
    expect(m.op(RECV_ACK)).toBe(0x50);
    const msb = m.twdr;
    expect(m.op(RECV_NACK)).toBe(0x58);
    const lsb = m.twdr;
    m.op(STOP);
    expect(((msb << 8) | lsb) >> 4).toBe(Math.round(21.5 / 0.0625));
    expect(r.rt.warnings().some((w) => w.includes('desteklenmiyor'))).toBe(false);
  });
  it('an address with no device is NACKed (0x20)', () => {
    const r = setup(twiCircuit(true));
    const m = master(r);
    expect(m.op(START)).toBe(0x08);
    expect(m.op(SEND, 0x30 << 1)).toBe(0x20);
    m.op(STOP);
  });
  it('without pull-ups even the real device is NACKed and "SDA/SCL pull-up yok" is reported', () => {
    const r = setup(twiCircuit(false));
    const m = master(r);
    expect(m.op(START)).toBe(0x08);
    expect(m.op(SEND, 0x48 << 1)).toBe(0x20);
    m.op(STOP);
    expect(r.rt.warnings().some((w) => w.includes('SDA/SCL pull-up yok'))).toBe(true);
  });
  it('EEPROM: byte write, tWR busy -> NACK, read back after the write cycle', () => {
    const r = setup(twiCircuit(true, 'busdev_24c02'));
    const m = master(r);
    m.op(START); expect(m.op(SEND, 0x50 << 1)).toBe(0x18);
    m.op(SEND, 0x20); m.op(SEND, 0x5a); m.op(STOP);
    m.op(START);
    expect(m.op(SEND, 0x50 << 1)).toBe(0x20);              // busy, ACK polling
    m.op(STOP);
    for (let i = 0; i < 3; i++) r.step(2000);              // 6 ms later the write cycle is over
    m.op(START); expect(m.op(SEND, 0x50 << 1)).toBe(0x18);
    m.op(SEND, 0x20); m.op(START);
    expect(m.op(SEND, (0x50 << 1) | 1)).toBe(0x40);
    expect(m.op(RECV_NACK)).toBe(0x58);
    expect(m.twdr).toBe(0x5a);
    m.op(STOP);
  });
});

describe('AVR HEX runtime: SPI master on the bus layer', () => {
  function adc(csWiredTo: 'D10/SS' | 'none' = 'D10/SS') {
    const b = new CircuitBuilder();
    b.add('mod_arduino_uno_r3', {}, 0, 0, 0, 'U1');
    b.add('busdev_mcp3008', {}, 4, 0, 0, 'A1');
    b.add('resistor', { r: 1000 }, 0, 0, 0, 'RT'); b.add('resistor', { r: 3000 }, 0, 0, 0, 'RB');
    b.add('ground');
    b.chain('U1.GND', 'GND1.G');
    b.wire('U1.5V', 'A1.VDD'); b.wire('U1.5V', 'A1.VREF'); b.wire('U1.GND', 'A1.DGND'); b.wire('U1.GND', 'A1.AGND');
    b.wire('U1.D13/SCK', 'A1.CLK'); b.wire('U1.D12/MISO', 'A1.DOUT'); b.wire('U1.D11/MOSI', 'A1.DIN');
    if (csWiredTo !== 'none') b.wire(`U1.${csWiredTo}`, 'A1.CS');
    b.wire('U1.5V', 'RT.1'); b.wire('RT.2', 'A1.CH0'); b.wire('RT.2', 'RB.1'); b.wire('RB.2', 'U1.GND');
    return b.circuit;
  }
  const xfer = (r: ReturnType<typeof setup>, v: number): number => {
    r.cpu.writeData(SPDR, v);
    r.step(10);
    expect(r.cpu.data[SPSR] & 0x80).toBe(0x80); // SPIF
    return r.cpu.data[SPDR];
  };
  it('MCP3008 frame via SPDR with CS = PB2 driven low reads 768 (3.75 V of 5 V)', () => {
    const r = setup(adc());
    r.cpu.writeData(DDRB, (1 << 2) | (1 << 3) | (1 << 5)); // SS, MOSI, SCK outputs
    r.cpu.writeData(PORTB, 1 << 2);                         // CS high
    r.cpu.writeData(SPCR, 0x50);                            // SPE | MSTR
    r.step();
    r.cpu.writeData(PORTB, 0);                              // CS low
    xfer(r, 1);
    const hi = xfer(r, 0x80);
    const lo = xfer(r, 0);
    r.cpu.writeData(PORTB, 1 << 2);                         // CS high
    expect(Math.abs((((hi & 3) << 8) | lo) - 768)).toBeLessThanOrEqual(2);
    // second frame after CS toggled
    r.cpu.writeData(PORTB, 0);
    xfer(r, 1);
    const hi2 = xfer(r, 0x80);
    expect(Math.abs((((hi2 & 3) << 8) | xfer(r, 0)) - 768)).toBeLessThanOrEqual(2);
  });
  it('CS wired to nothing: the chip is never selected and MISO reads 0', () => {
    const r = setup(adc('none'));
    r.cpu.writeData(DDRB, (1 << 2) | (1 << 3) | (1 << 5));
    r.cpu.writeData(SPCR, 0x50);
    r.step();
    xfer(r, 1);
    expect(xfer(r, 0x80)).toBe(0);
    expect(xfer(r, 0)).toBe(0);
  });
  it('without a bus link TWI/SPI use is only reported, not faked', () => {
    const spec = getDef('mod_arduino_uno_r3').mcu!;
    const rt = new AvrRuntime(spec);
    rt.load(IDLE_HEX);
    const cpu = (rt as unknown as { cpu: Cpu }).cpu;
    cpu.data[TWCR] = 0x04;
    cpu.data[SPCR] = 0x40;
    const w = rt.warnings();
    expect(w.some((x) => x.includes('I2C desteklenmiyor'))).toBe(true);
    expect(w.some((x) => x.includes('SPI desteklenmiyor'))).toBe(true);
  });
});
