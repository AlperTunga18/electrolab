import type { Diagnostic } from '../types';

export const FLASH_BASE = 0x10000000;
export const FLASH_BYTES = 16 * 1024 * 1024;
const MAGIC0 = 0x0a324655;
const MAGIC1 = 0x9e5d5157;
const MAGIC_END = 0x0ab16f30;
const FLAG_NOT_MAIN_FLASH = 0x1;

export interface Uf2Result {
  ok: boolean;
  /** XIP flash image (0xFF filled, FLASH_BYTES long); only valid when ok */
  image: Uint8Array;
  /** payload bytes written to flash */
  size: number;
  diagnostics: Diagnostic[];
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** UF2 -> flash image. Blocks outside 0x10000000..0x11000000 or flagged "not main flash" are skipped. `line` in diagnostics = 1-based block number. */
export function parseUf2(bytes: Uint8Array): Uf2Result {
  const image = new Uint8Array(FLASH_BYTES).fill(0xff);
  const diagnostics: Diagnostic[] = [];
  const err = (line: number, message: string) => diagnostics.push({ line, message, severity: 'error' });
  if (bytes.length === 0 || bytes.length % 512 !== 0) {
    err(1, 'UF2: dosya boyutu 512 baytın katı değil.');
    return { ok: false, image, size: 0, diagnostics };
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let size = 0;
  for (let b = 0; b < bytes.length / 512; b++) {
    const o = b * 512;
    if (dv.getUint32(o, true) !== MAGIC0 || dv.getUint32(o + 4, true) !== MAGIC1 || dv.getUint32(o + 508, true) !== MAGIC_END) {
      err(b + 1, 'UF2: blok sihirli sayıları geçersiz.');
      return { ok: false, image, size: 0, diagnostics };
    }
    const flags = dv.getUint32(o + 8, true);
    const addr = dv.getUint32(o + 12, true);
    const n = dv.getUint32(o + 16, true);
    if (flags & FLAG_NOT_MAIN_FLASH) continue;
    if (n > 476) {
      err(b + 1, 'UF2: blok veri boyutu geçersiz.');
      return { ok: false, image, size: 0, diagnostics };
    }
    if (addr < FLASH_BASE || addr + n > FLASH_BASE + FLASH_BYTES) continue;
    image.set(bytes.subarray(o + 32, o + 32 + n), addr - FLASH_BASE);
    size += n;
  }
  if (size === 0) {
    err(1, 'UF2: ana flash (0x10000000) için veri yok.');
    return { ok: false, image, size: 0, diagnostics };
  }
  return { ok: true, image, size, diagnostics };
}
