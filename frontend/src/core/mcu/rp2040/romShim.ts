/**
 * ROM shim: NOT the Raspberry Pi bootrom. rp2040js does not bundle the RP2040 bootrom and this project does not ship it, but
 * Pico SDK / arduino-pico code calls helper routines through the bootrom function table (rom_func_lookup, header halfwords at
 * 0x14/0x16/0x18). This shim writes a minimal header into the (otherwise empty) bootrom and implements the few helper
 * functions in JS, triggered when the program counter enters a stub address in the bootrom region (< STUB_END):
 *   P3 popcount32, L3 clz32, T3 ctz32, R3 reverse32, MS memset, MC memcpy, S4 memset4, C4 memcpy4;
 *   flash: IF connect, EX exit-XIP, FC flush, CX enter-cmd-XIP (no-ops: flash is memory-mapped in the emulator),
 *   RE range erase / RP range program (applied straight to the emulated flash array; no SSI timing, no wear model).
 * Anything else that firmware looks up (soft-float 'SF' tables, divider, USB boot, wait-for-vector ...) is NOT
 * implemented: lookup returns 0 and `unknown` collects the code names so the runtime can report them.
 * The bootrom boot sequence itself (boot2 -> XIP setup) is not run either; the runtime starts at the flash vector table.
 */
import type { RP2040 } from 'rp2040js';

const FUNC_TABLE = 0x100;
const DATA_TABLE = 0x200;
const LOOKUP_STUB = 0x300;
const FN_BASE = 0x400;
export const STUB_END = 0x1000;

type Core = RP2040['core'];
type Handler = (core: Core) => void;

function codeName(code: number): string {
  return String.fromCharCode(code & 255, (code >> 8) & 255);
}

export class RomShim {
  private fns = new Map<number, { name: string; run: Handler }>(); // stub address -> handler
  private byCode = new Map<string, number>(); // 2-char code -> stub address
  readonly unknown = new Set<string>();

  constructor(chip: RP2040) {
    const rom = new Uint16Array(chip.bootrom.buffer);
    rom[0x14 / 2] = FUNC_TABLE;
    rom[0x16 / 2] = DATA_TABLE;
    rom[0x18 / 2] = LOOKUP_STUB | 1;
    const reg = (name: string, run: Handler) => {
      const addr = FN_BASE + this.fns.size * 4;
      this.fns.set(addr, { name, run });
      this.byCode.set(name, addr | 1);
    };
    const R = (c: Core) => c.registers;
    reg('P3', (c) => {
      let v = R(c)[0] >>> 0;
      v -= (v >>> 1) & 0x55555555;
      v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
      R(c)[0] = (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
    });
    reg('L3', (c) => { R(c)[0] = Math.clz32(R(c)[0]); });
    reg('T3', (c) => { const v = R(c)[0]; R(c)[0] = v === 0 ? 32 : 31 - Math.clz32(v & -v); });
    reg('R3', (c) => {
      let v = R(c)[0] >>> 0, r = 0;
      for (let i = 0; i < 32; i++) { r = (r << 1) | (v & 1); v >>>= 1; }
      R(c)[0] = r >>> 0;
    });
    const memset: Handler = (c) => {
      const [d, v, n] = [R(c)[0], R(c)[1] & 255, R(c)[2]];
      for (let i = 0; i < n; i++) c.writeUint8(d + i, v);
    };
    const memcpy: Handler = (c) => {
      const [d, s, n] = [R(c)[0], R(c)[1], R(c)[2]];
      for (let i = 0; i < n; i++) c.writeUint8(d + i, c.readUint8(s + i));
    };
    for (const n of ['IF', 'EX', 'FC', 'CX']) reg(n, () => {});
    const flash = chip.flash;
    reg('RE', (c) => {
      const [a, n] = [R(c)[0] >>> 0, R(c)[1] >>> 0];
      if (a + n <= flash.length) flash.fill(0xff, a, a + n);
    });
    reg('RP', (c) => {
      const [a, src, n] = [R(c)[0] >>> 0, R(c)[1], R(c)[2] >>> 0];
      if (a + n > flash.length) return;
      for (let i = 0; i < n; i++) flash[a + i] &= c.readUint8(src + i);
    });
    reg('MS', memset); reg('S4', memset);
    reg('MC', memcpy); reg('C4', memcpy);
  }

  /** If the PC is in a ROM stub, run it (returns true, PC set to LR); `cycles` consumed is returned via the result. */
  handle(core: Core): number {
    const pc = core.PC;
    if (pc === LOOKUP_STUB) {
      const name = codeName(core.registers[1]);
      const table = core.registers[0];
      const addr = table === FUNC_TABLE ? this.byCode.get(name) : undefined;
      if (addr === undefined) this.unknown.add(name);
      core.registers[0] = addr ?? 0;
      core.PC = core.LR & ~1;
      return 8;
    }
    const f = this.fns.get(pc);
    if (f) {
      f.run(core);
      core.PC = core.LR & ~1;
      return 20;
    }
    return 0;
  }
}
