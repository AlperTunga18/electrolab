import { useState } from 'react';
import { useLab } from '../store/lab';
import { saveUserPart } from '../library/components';
import type { ComponentDef } from '../library/types';
import { checkModelFile, deleteModel, saveModel } from '../core/model3d/store';

const btn = 'px-2.5 py-1 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700';

/** Assign a local .glb/.gltf (max 2 MB) as the 3D visual of a user part. No network; STEP unsupported. */
export function Model3dUpload({ c }: { c: ComponentDef }) {
  const s = useLab();
  const [msg, setMsg] = useState('');
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const bad = checkModelFile(f.name, f.size);
    if (bad) { setMsg(bad); return; }
    try {
      const id = `m3d_${c.type}`;
      await saveModel(id, f);
      saveUserPart({ ...c, model3d: { id, fileName: f.name } });
      s.set({ libVersion: s.libVersion + 1 });
      setMsg(`“${f.name}” atandı (ölçek/merkez parça boyutuna göre ayarlanır).`);
    } catch (e) { setMsg(`Kaydedilemedi: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const remove = async () => {
    if (!c.model3d) return;
    try { await deleteModel(c.model3d.id); } catch { /* ignore */ }
    const { model3d: _drop, ...rest } = c;
    void _drop;
    saveUserPart(rest);
    s.set({ libVersion: s.libVersion + 1 });
    setMsg('3D model kaldırıldı.');
  };
  return (
    <div className="mt-2 text-[11px] text-zinc-400 space-y-1">
      <div className="flex gap-2 items-center flex-wrap">
        <label className={`${btn} cursor-pointer`}>3D model yükle (.glb/.gltf)<input type="file" accept=".glb,.gltf,.step,.stp" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
        {c.model3d && <><span>Atanan: {c.model3d.fileName}</span><button className={btn} onClick={() => void remove()}>Kaldır</button></>}
      </div>
      <div>Yerel (ağ yok), en fazla 2 MB. STEP desteklenmiyor. Harici doku/bin dosyası gerektiren .gltf çalışmaz; tek dosyalı .glb önerilir.</div>
      {msg && <div className="text-amber-300">{msg}</div>}
    </div>
  );
}
