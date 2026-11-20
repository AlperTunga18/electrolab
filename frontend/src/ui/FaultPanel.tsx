import { useState } from 'react';
import { useLab } from '../store/lab';
import { getDef } from '../library/components';
import { FAULT_LABEL, faultOptions } from '../core/sim/faults';
import { HEATSINKS, CLASS_LABEL, etaToLimit, thermalClass, thermalColor, thermalSpec } from '../core/thermal/thermal';
import { CAUSE_LABEL } from '../core/sim/damage';
import { formatSI } from '../core/units';
import type { Fault, FaultKind, HeatsinkSize, PlacedComponent } from '../core/circuit/types';

const btn = 'px-2.5 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700';
const sel = 'w-full bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-sm';

export function ThermalSection({ comp }: { comp: PlacedComponent }) {
  const s = useLab();
  const def = getDef(comp.type);
  const spec = thermalSpec(def, comp);
  const th = s.live?.thermal[comp.id];
  if (!spec) return null;
  const amb = s.circuit.ambient ?? 25;
  const cls = th ? thermalClass(th.T, amb, th.tjmax) : null;
  const eta = th ? etaToLimit(th.T, th.P, amb, th.rth, th.cth, th.tjmax) : null;
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 p-2 text-xs space-y-1.5">
      <div className="text-zinc-400 font-semibold">Isıl model <span className="font-normal text-zinc-600">(tahmini Rθ/Cth)</span></div>
      {spec.heatsinkable && (
        <label className="block text-zinc-400">Soğutucu
          <select className={sel} value={comp.thermal?.heatsink ?? 'none'} onChange={(e) => s.setThermalAccessory(comp.id, { heatsink: e.target.value as HeatsinkSize })}>
            {(Object.keys(HEATSINKS) as HeatsinkSize[]).map((k) => <option key={k} value={k}>{HEATSINKS[k].label}</option>)}
          </select>
        </label>
      )}
      <label className="flex items-center gap-2 text-zinc-400"><input type="checkbox" checked={comp.thermal?.fan ?? false} onChange={(e) => s.setThermalAccessory(comp.id, { fan: e.target.checked })} />Fan (zorlamalı hava; konveksiyon direnci ×0.4)</label>
      {!spec.heatsinkable && <div className="text-zinc-600">Bu paket için soğutucu modeli yok.</div>}
      {th ? (
        <div className="space-y-0.5">
          <div>Tj: <b style={{ color: thermalColor(th.T, amb, th.tjmax) }}>{th.T.toFixed(1)} °C</b> / limit {th.tjmax} °C — {cls ? CLASS_LABEL[cls] : ''}</div>
          <div>Güç kaybı: {formatSI(th.P, 'W')} · Rθja,eff ≈ {th.rth.toFixed(1)} K/W · τ ≈ {formatSI(th.rth * th.cth, 's')}</div>
          {s.live?.thermalSteady && <div className="text-zinc-500">Kararlı hal (steady-state) tahmini.</div>}
          {eta && eta.high > 0 && <div className="text-amber-300">Bu güçte Tj limite yaklaşıyor: tahmini {formatSI(eta.low, 's')} – {formatSI(eta.high, 's')} (ısıl süre; model yaklaşık, kesin süre değildir).</div>}
        </div>
      ) : <div className="text-zinc-600">Değer için DC çöz / Çalıştır.</div>}
      <div className="text-zinc-600">Rθ dayanağı: {spec.basis}. Ortam: {amb} °C.</div>
    </div>
  );
}

export function FaultSection({ comp }: { comp: PlacedComponent }) {
  const s = useLab();
  const def = getDef(comp.type);
  const opts = faultOptions(def);
  const cur = s.circuit.faults?.[comp.id];
  const auto = s.live?.faults[comp.id]?.auto ? s.live.faults[comp.id] : undefined;
  const [kind, setKind] = useState<FaultKind | ''>('');
  const [amount, setAmount] = useState('');
  const [pin, setPin] = useState('');
  const [to, setTo] = useState('');
  if (!opts.length) return null;
  const o = opts.find((x) => x.kind === kind);
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 p-2 text-xs space-y-1.5">
      <div className="text-zinc-400 font-semibold">Arıza laboratuvarı <span className="font-normal text-zinc-600">(normal simülasyondan bağımsız)</span></div>
      {auto && <div className="text-red-300">Hasar modeli: {FAULT_LABEL[auto.kind]} (t={formatSI(auto.t ?? 0, 's')}). Sıfırla ile temizlenir.</div>}
      {cur && <div className="text-amber-300">Aktif enjekte arıza: <b>{FAULT_LABEL[cur.kind]}</b>{cur.amount !== undefined ? ` (${cur.amount})` : ''} <button className={btn} onClick={() => s.setFault(comp.id, null)}>Kaldır</button></div>}
      <select className={sel} value={kind} onChange={(e) => { const k = e.target.value as FaultKind | ''; setKind(k); const op = opts.find((x) => x.kind === k); setAmount(op?.amountDefault !== undefined ? String(op.amountDefault) : ''); }}>
        <option value="">Arıza seç…</option>
        {opts.map((x) => <option key={x.kind} value={x.kind}>{x.label}</option>)}
      </select>
      {o && <div className="text-zinc-500">{o.hint}</div>}
      {o?.pinTarget && (
        <>
          <label className="block text-zinc-400">Kaçağın başladığı pin
            <select className={sel} value={pin} onChange={(e) => setPin(e.target.value)}>
              <option value="">Varsayılan (ana uç)</option>
              {def.pins.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label className="block text-zinc-400">Hedef düğüm
            <select className={sel} value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Toprak (GND)</option>
              {s.circuit.components.filter((x) => x.id !== comp.id && getDef(x.type).model !== 'ground').flatMap((x) => getDef(x.type).pins.map((p) => <option key={`${x.id}:${p.id}`} value={`${x.id}:${p.id}`}>{x.ref}.{p.label}</option>))}
            </select>
          </label>
        </>
      )}
      {o?.amountLabel && <label className="block text-zinc-400">{o.amountLabel}<input className={sel} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>}
      <button className={btn} disabled={!o} onClick={() => { if (o) { const n = Number(amount); const f: Fault = { kind: o.kind, amount: o.amountLabel && Number.isFinite(n) ? n : undefined }; if (o.pinTarget) { if (pin) f.pin = pin; if (to) { const [tc, tp] = to.split(':'); f.to = { comp: tc, pin: tp }; } } s.setFault(comp.id, f); } }}>Arızayı uygula</button>
    </div>
  );
}

export function FailuresView() {
  const s = useLab();
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const faults = Object.entries(s.circuit.faults ?? {});
  return (
    <div className="h-full overflow-y-auto p-3 text-xs space-y-3">
      <div className="flex gap-4 flex-wrap items-center">
        <label className="flex items-center gap-1.5 text-zinc-300"><input type="checkbox" checked={s.damageEnabled} onChange={(e) => s.setDamageEnabled(e.target.checked)} />Hasar uygula (aşırı yüklenen parça gerçekten arızalanır)</label>
        <button className={btn} onClick={s.clearFailures}>Geçmişi temizle</button>
      </div>
      {faults.length > 0 && (
        <div>
          <div className="text-zinc-500 uppercase tracking-wide mb-1">Enjekte edilen arızalar</div>
          {faults.map(([id, f]) => { const c = s.circuit.components.find((x) => x.id === id); return <div key={id} className="text-amber-300">{c?.ref ?? id}: {FAULT_LABEL[f.kind]}{f.amount !== undefined ? ` (${f.amount})` : ''}{f.pin ? ` · ${f.pin}` : ''}{f.to ? ` → ${f.to.comp}.${f.to.pin}` : f.kind === 'insulationFault' ? ' → GND' : ''}</div>; })}
        </div>
      )}
      {s.circuit.wires.some((w) => w.broken) && <div className="text-amber-300">Kopuk kablolar: {s.circuit.wires.filter((w) => w.broken).map((w) => `${w.a.comp}.${w.a.pin}↔${w.b.comp}.${w.b.pin}`).join(', ')}</div>}
      {s.circuit.wires.some((w) => w.loose) && <div className="text-amber-300">Gevşek konnektörler: {s.circuit.wires.filter((w) => w.loose).map((w) => `${w.a.comp}.${w.a.pin}↔${w.b.comp}.${w.b.pin}`).join(', ')}</div>}
      {!s.failures.length && <div className="text-zinc-500">Henüz hasar oluşmadı. Bir parçayı sınırlarının ötesinde zorlayın (örn. LED’i direnç olmadan bağlayın) ya da parça seçip “Arıza laboratuvarı”ndan arıza enjekte edin.</div>}
      <div className="space-y-2">
        {s.failures.map((f) => (
          <div key={f.id} className="rounded border border-red-800 bg-red-950/30 p-3 space-y-1">
            <div className="flex justify-between"><b className="text-red-300">⚠ {f.ref} — {f.name}</b><span className="text-zinc-400">t = {formatSI(f.t, 's')}</span></div>
            <div><b>Arıza:</b> {FAULT_LABEL[f.mode]} · <b>Neden:</b> {CAUSE_LABEL[f.cause]}</div>
            <div><b>Aşılan sınır:</b> {f.limitLabel}: {f.cause === 'thermal' ? `${f.value.toFixed(0)} °C ≥ ${f.limit} °C` : f.cause === 'reverse' && f.limit === 0 ? `ters ${f.value.toFixed(1)} V` : `${f.value.toPrecision(3)} ${f.unit} (limit ${f.limit} ${f.unit})`}</div>
            <div><b>Anındaki değerler:</b> V = {formatSI(f.v, 'V')}, I = {formatSI(f.i, 'A')}, P = {formatSI(f.p, 'W')}{f.T !== undefined ? `, Tj = ${f.T.toFixed(0)} °C` : ''}</div>
            <div><b>Bağlantılar:</b> {f.connections.join(' · ')}</div>
            {f.sameCurrent.length > 0 && <div><b>Aynı akımı taşıyan elemanlar:</b> {f.sameCurrent.join(', ')}</div>}
            <button className={btn} onClick={() => setOpen({ ...open, [f.id]: !open[f.id] })}>{open[f.id] ? 'Çözüm önerilerini gizle' : 'Çözüm önerilerini göster'}</button>
            {open[f.id] && (
              <div className="space-y-1 pt-1">
                {f.prevent.length > 0 && <div><b>Hangi koruma arızayı önlerdi:</b> {f.prevent.join('; ')}</div>}
                <div><b>Nasıl düzeltilmeli:</b><ul className="list-disc ml-5">{f.fix.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
              </div>
            )}
            <div className="text-[11px] text-zinc-500">{f.uncertainty}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
