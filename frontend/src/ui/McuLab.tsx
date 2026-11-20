import { useEffect, useState } from 'react';
import { useLab } from '../store/lab';
import { getDef } from '../library/components';
import { COMPAT, MCU_BOARD_IDS, PERIPHERALS, SUPPORT_LABEL, type Support } from '../core/mcu/boards';
import { EXAMPLES } from '../examples/examples';
import { PageShell } from './Pages';

const card = 'rounded-lg border border-zinc-800 bg-zinc-900';
const btn = 'px-3 py-1.5 rounded text-sm border border-zinc-700 bg-zinc-800 hover:bg-zinc-700';

const CELL: Record<Support, string> = { sim: 'bg-emerald-900/70 text-emerald-300', partial: 'bg-amber-900/70 text-amber-300', hw: 'bg-zinc-800 text-zinc-400', na: 'text-zinc-700' };
const CELL_TXT: Record<Support, string> = { sim: '✔ simüle', partial: '◐ kısmi', hw: '✖ simüle değil', na: '—' };

interface Toolchain { id: string; name: string; available: boolean; status: string; notes: string; version?: string }

export function McuLab() {
  const s = useLab();
  const [tools, setTools] = useState<Toolchain[] | null>(null);
  useEffect(() => { void fetch('/api/mcu/toolchains').then((r) => (r.ok ? r.json() : null)).then((j) => setTools(Array.isArray(j) ? j : null)).catch(() => setTools(null)); }, []);
  const demos = EXAMPLES.filter((e) => e.level === 'mcu' || e.id === 'esp32_5v');
  return (
    <PageShell title="Mikrodenetleyici Laboratuvarı">
      <div className={`${card} p-4 mb-4 space-y-2 text-sm`}>
        <b>Neler gerçekten çalışıyor?</b>
        <ul className="list-disc ml-5 text-zinc-300 space-y-1">
          <li><b>Arduino sketch yorumlayıcısı</b> (Uno/Nano/Mega, ESP32 DevKit V1, Raspberry Pi Pico): Arduino C++ alt kümesi (pinMode, digitalWrite/Read, analogRead/Write, delay, millis, Serial…) <i>simüle zaman</i> üzerinde çalışır. Gerçek derleyici veya çip emülatörü değildir.</li>
          <li><b>AVR HEX emülatörü</b> (avr8js, ATmega328P — Uno/Nano): Arduino IDE’nin ürettiği <i>gerçek makine kodunu</i> çalıştırır (GPIO, Timer/PWM, USART, ADC).</li>
          <li>GPIO pinleri elektriksel çözücüye bağlıdır: çıkış = Thevenin kaynağı (~40 Ω AVR, ~30 Ω ESP32, ~50 Ω Pico), giriş = pinin gerçek düğüm gerilimi. Yükler pin akımını çeker, gerilim düşer; sınırlar aşılırsa uyarı/hasar.</li>
          <li><b>Yok:</b> I2C/SPI cihazları, Wi-Fi/BLE, kesmeler (sketch modunda), DAC, brownout, ESP-IDF/PlatformIO derlemesi, Renode/QEMU/Wokwi. Bu çağrılar uyarı verir ve yok sayılır.</li>
        </ul>
      </div>

      <h2 className="font-semibold mb-2">Araç zincirleri (sunucu)</h2>
      <div className="grid md:grid-cols-3 gap-2 mb-5">
        {tools ? tools.map((t) => (
          <div key={t.id} className={`${card} p-3 text-xs`}>
            <b>{t.name}</b> <span className={t.available ? 'text-emerald-400' : 'text-zinc-500'}>{t.status === 'available' ? 'kurulu' : t.status === 'planned' ? 'planlanıyor' : 'kurulu değil'}</span>
            <div className="text-zinc-500 mt-1">{t.notes}</div>
          </div>
        )) : <div className="text-zinc-500 text-sm">Sunucu çevrimdışı: gerçek derleme (arduino-cli) kullanılamaz. Yorumlayıcı ve HEX emülatörü tarayıcıda çalışır.</div>}
      </div>

      <h2 className="font-semibold mb-2">Uyumluluk matrisi</h2>
      <div className={`${card} p-3 mb-5 overflow-x-auto`}>
        <table className="text-xs w-full">
          <thead><tr className="text-left text-zinc-400"><th className="py-1 pr-3">Çevre birimi</th>{COMPAT.map((b) => <th key={b.id} className="pr-3 whitespace-nowrap">{b.name}</th>)}</tr></thead>
          <tbody>
            {PERIPHERALS.map((p, i) => (
              <tr key={p} className="border-t border-zinc-800"><td className="py-1 pr-3 text-zinc-300">{p}</td>
                {COMPAT.map((b) => <td key={b.id} className="pr-3"><span className={`px-1.5 py-0.5 rounded ${CELL[b.cells[i]]}`} title={SUPPORT_LABEL[b.cells[i]]}>{CELL_TXT[b.cells[i]]}</span></td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-[11px] text-zinc-500 mt-2">“simüle değil” = donanımda var ama bu uygulamada modeli yok (çalışıyormuş gibi gösterilmez). ADC ESP32’de kısmi: gerçek ADC doğrusal değildir, burada ideal doğrusal. HEX modunda donanım davranışı avr8js’in desteği kadardır (TWI/SPI algılanır ama modellenmez).</div>
      </div>

      <h2 className="font-semibold mb-2">Desteklenen kartlar</h2>
      <div className="grid md:grid-cols-2 gap-3 mb-5">
        {MCU_BOARD_IDS.map((id) => {
          const d = getDef(id), spec = d.mcu!;
          return (
            <div key={id} className={`${card} p-3 text-xs space-y-1`}>
              <div className="flex justify-between"><b className="text-sm">{d.name}</b><span className="text-zinc-500">{spec.family.toUpperCase()} · {spec.vcc} V · {spec.adcBits}-bit ADC</span></div>
              <div className="text-zinc-400">GPIO eşlemesi: {Object.keys(spec.pinMap).length} pin · PWM: {spec.pwmPins.length} pin ({spec.pwmHz} Hz) · ADC: {spec.adcPins.length} pin · giriş-yalnız: {spec.inputOnly.length ? spec.inputOnly.join(', ') : '—'}</div>
              <div className="text-zinc-400">Pin akımı: {(spec.imaxPin * 1000).toFixed(0)} mA mutlak · Çıkış direnci ≈ {spec.rOutHigh} Ω · Pull-up ≈ {(spec.rPullup / 1000).toFixed(0)} kΩ</div>
              <ul className="list-disc ml-4 text-amber-200/80">{spec.notes.map((n) => <li key={n}>{n}</li>)}</ul>
              <button className={btn} onClick={() => { s.go('lab'); s.arm(id); }}>Laboratuvara ekle</button>
            </div>
          );
        })}
      </div>

      <h2 className="font-semibold mb-2">Hazır MCU devreleri</h2>
      <div className="grid md:grid-cols-2 gap-3">
        {demos.map((e) => (
          <div key={e.id} className={`${card} p-3 text-xs space-y-1`}>
            <b className="text-sm">{e.title}</b>
            <p className="text-zinc-400">{e.summary}</p>
            <div className="text-emerald-300/90">Beklenen: {e.expected}</div>
            <button className={btn} onClick={() => { s.loadCircuit(e.build(), e.title); if (e.speed) s.setSpeed(e.speed); s.go('lab'); }}>Laboratuvarda aç</button>
          </div>
        ))}
      </div>
    </PageShell>
  );
}
