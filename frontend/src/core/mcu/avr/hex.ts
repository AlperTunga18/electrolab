import type { Diagnostic } from '../types';

export const FLASH_BYTES = 32768;

export interface HexResult {
  ok: boolean;
  /** flash image (0xFF filled), FLASH_BYTES long; only valid when ok */
  image: Uint8Array;
  /** number of data bytes loaded */
  size: number;
  diagnostics: Diagnostic[];
}

/** Intel HEX -> flash image. Malformed input gives Turkish diagnostics, `line` = 1-based hex line. */
export function parseIntelHex(text: string): HexResult {
  const image = new Uint8Array(FLASH_BYTES).fill(0xff);
  const diagnostics: Diagnostic[] = [];
  const err = (line: number, message: string) => diagnostics.push({ line, message, severity: 'error' });
  let upper = 0;
  let size = 0;
  let eof = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    const ln = i + 1;
    if (raw === '') continue;
    if (eof) {
      err(ln, 'HEX: Dosya sonu kaydından (:00000001FF) sonra veri var.');
      break;
    }
    if (raw[0] !== ':') {
      err(ln, "HEX: Satır ':' ile başlamalı.");
      continue;
    }
    const body = raw.slice(1);
    if (!/^[0-9a-fA-F]+$/.test(body) || body.length % 2 !== 0 || body.length < 10) {
      err(ln, 'HEX: Satır geçersiz (onaltılık basamak sayısı çift ve en az 10 olmalı).');
      continue;
    }
    const bytes: number[] = [];
    for (let k = 0; k < body.length; k += 2) bytes.push(parseInt(body.slice(k, k + 2), 16));
    const len = bytes[0];
    if (bytes.length !== len + 5) {
      err(ln, `HEX: Uzunluk alanı (${len}) satırın gerçek uzunluğuyla uyuşmuyor.`);
      continue;
    }
    if (bytes.reduce((a, b) => (a + b) & 0xff, 0) !== 0) {
      err(ln, 'HEX: Sağlama toplamı (checksum) hatalı.');
      continue;
    }
    const addr = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    const data = bytes.slice(4, 4 + len);
    if (type === 0x00) {
      const base = upper + addr;
      if (base + len > FLASH_BYTES) {
        err(ln, `HEX: Adres 0x${(base + len).toString(16)} 32 KB flash sınırını aşıyor.`);
        continue;
      }
      for (let k = 0; k < len; k++) image[base + k] = data[k];
      size += len;
    } else if (type === 0x01) {
      eof = true;
    } else if (type === 0x02 || type === 0x04) {
      if (len !== 2) {
        err(ln, 'HEX: Genişletilmiş adres kaydı 2 bayt olmalı.');
        continue;
      }
      const v = (data[0] << 8) | data[1];
      upper = type === 0x02 ? v << 4 : v * 65536;
    } else if (type === 0x03 || type === 0x05) {
      /* start address records: ignored */
    } else {
      err(ln, `HEX: Bilinmeyen kayıt türü 0x${type.toString(16).padStart(2, '0')}.`);
    }
  }
  if (!diagnostics.some((d) => d.severity === 'error')) {
    if (size === 0) err(lines.length, 'HEX: Dosyada program verisi yok.');
    else if (!eof) diagnostics.push({ line: lines.length, message: 'HEX: Dosya sonu kaydı (:00000001FF) eksik.', severity: 'warning' });
  }
  return { ok: !diagnostics.some((d) => d.severity === 'error'), image, size, diagnostics };
}
