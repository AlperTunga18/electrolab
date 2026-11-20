import { useState } from 'react';
import type { Footprint, Pad } from '../core/pcb/types';

const inp = 'bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-zinc-200 w-14';
const btn = 'px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200';

/** courtyard + silk rebuilt from the pads (margin 0.5 mm), same convention as the generators */
export function finishFootprint(name: string, pads: Pad[]): Footprint {
  const w0 = Math.max(0.5, ...pads.map((p) => Math.abs(p.x) + p.w / 2)), h0 = Math.max(0.5, ...pads.map((p) => Math.abs(p.y) + p.h / 2));
  const width = 2 * w0 + 0.5, height = 2 * h0 + 0.5, x1 = -width / 2, x2 = width / 2, y1 = -height / 2, y2 = height / 2;
  return {
    name, pads, width, height, smd: pads.every((p) => p.drill <= 0),
    silk: [{ x1, y1, x2, y2: y1 }, { x1: x2, y1, x2, y2 }, { x1: x2, y1: y2, x2: x1, y2: y1 }, { x1, y1: y2, x2: x1, y2: y1 }],
  };
}

/** Simple pad-table editor. `initial` seeds the table (e.g. the current footprint); Save calls onSave(key, footprint). */
export function FootprintEditor({ initial, onSave, onCancel }: { initial?: Footprint; onSave: (key: string, fp: Footprint) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial ? `${initial.name}-özel` : 'ÖZEL-1');
  const [pads, setPads] = useState<Pad[]>(initial?.pads.map((p) => ({ ...p })) ?? [{ pin: '1', x: -1, y: 0, shape: 'rect', w: 1, h: 1, drill: 0 }, { pin: '2', x: 1, y: 0, shape: 'rect', w: 1, h: 1, drill: 0 }]);
  const set = (i: number, patch: Partial<Pad>) => setPads((l) => l.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const valid = name.trim().length > 0 && pads.length > 0 && pads.every((p) => p.w > 0 && p.h > 0 && p.drill >= 0 && p.pin.trim());
  return (
    <div className="space-y-1 text-[11px]">
      <div className="text-zinc-300"><b>Footprint düzenleyici</b> <span className="text-zinc-500">(mm; pad pin adları parçanın pinlerine sırayla eşlenir)</span></div>
      <label className="flex items-center gap-2 text-zinc-400">Ad <input className={`${inp} !w-40`} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <table className="w-full text-zinc-400">
        <thead><tr className="text-zinc-500"><th>pin</th><th>x</th><th>y</th><th>w</th><th>h</th><th>delik</th><th>şekil</th><th /></tr></thead>
        <tbody>
          {pads.map((p, i) => (
            <tr key={i}>
              <td><input className={`${inp} !w-10`} value={p.pin} onChange={(e) => set(i, { pin: e.target.value })} /></td>
              {(['x', 'y', 'w', 'h', 'drill'] as const).map((k) => <td key={k}><input className={inp} type="number" step="0.05" value={p[k]} onChange={(e) => set(i, { [k]: num(e.target.value) })} /></td>)}
              <td><select className={inp} value={p.shape} onChange={(e) => set(i, { shape: e.target.value as Pad['shape'] })}><option value="rect">rect</option><option value="circle">circle</option><option value="oval">oval</option></select></td>
              <td><button className="text-red-400 px-1" title="Pad'i sil" onClick={() => setPads((l) => l.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2">
        <button className={btn} onClick={() => setPads((l) => [...l, { pin: String(new Set(l.map((p) => p.pin)).size + 1), x: 0, y: 0, shape: 'rect', w: 1, h: 1, drill: 0 }])}>+ Pad</button>
        <button className={`${btn} disabled:opacity-40`} disabled={!valid} onClick={() => onSave(name.trim(), finishFootprint(name.trim(), pads))}>Kaydet</button>
        <button className={btn} onClick={onCancel}>Vazgeç</button>
      </div>
    </div>
  );
}
