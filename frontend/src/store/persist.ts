import type { Circuit } from '../core/circuit/types';
import { getDef, hasDef } from '../library/components';
import { formatSI } from '../core/units';

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  updated_at: string;
  version: number;
  source: 'backend' | 'local';
}

export interface ProjectFile {
  format: 'electrolab-project';
  version: 1;
  name: string;
  circuit: Circuit;
}

const LS_AUTOSAVE = 'electrolab.autosave';
const LS_PROJECTS = 'electrolab.projects';

const j = async <T>(r: Response): Promise<T> => {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as T;
};

export async function backendOnline(): Promise<boolean> {
  try {
    const r = await fetch('/api/health', { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

interface LocalProject { id: string; name: string; description: string; updated_at: string; version: number; circuit: Circuit }
const readLocal = (): LocalProject[] => {
  try { return JSON.parse(localStorage.getItem(LS_PROJECTS) ?? '[]') as LocalProject[]; } catch { return []; }
};
const writeLocal = (p: LocalProject[]) => localStorage.setItem(LS_PROJECTS, JSON.stringify(p));

export async function listProjects(): Promise<{ items: ProjectSummary[]; online: boolean }> {
  const online = await backendOnline();
  const local: ProjectSummary[] = readLocal().map((p) => ({ id: p.id, name: p.name, description: p.description, updated_at: p.updated_at, version: p.version, source: 'local' }));
  if (!online) return { items: local, online };
  const remote = await j<Omit<ProjectSummary, 'source'>[]>(await fetch('/api/projects'));
  return { items: [...remote.map((p) => ({ ...p, source: 'backend' as const })), ...local], online };
}

export async function saveProject(id: string | null, name: string, circuit: Circuit, source: 'backend' | 'local' | null): Promise<{ id: string; source: 'backend' | 'local' }> {
  const online = await backendOnline();
  if (online && source !== 'local') {
    if (id) {
      await j(await fetch(`/api/projects/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data: circuit }) }));
      return { id, source: 'backend' };
    }
    const p = await j<{ id: string }>(await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data: circuit }) }));
    return { id: p.id, source: 'backend' };
  }
  const all = readLocal();
  const now = new Date().toISOString();
  const existing = id ? all.find((p) => p.id === id) : undefined;
  if (existing) { existing.name = name; existing.circuit = circuit; existing.updated_at = now; existing.version++; writeLocal(all); return { id: existing.id, source: 'local' }; }
  const nid = crypto.randomUUID();
  all.unshift({ id: nid, name, description: '', updated_at: now, version: 1, circuit });
  writeLocal(all);
  return { id: nid, source: 'local' };
}

export async function loadProject(id: string, source: 'backend' | 'local'): Promise<{ name: string; circuit: Circuit }> {
  if (source === 'local') {
    const p = readLocal().find((q) => q.id === id);
    if (!p) throw new Error('Proje bulunamadı');
    return { name: p.name, circuit: sanitize(p.circuit) };
  }
  const p = await j<{ name: string; data: Circuit }>(await fetch(`/api/projects/${id}`));
  return { name: p.name, circuit: sanitize(p.data) };
}

export async function deleteProject(id: string, source: 'backend' | 'local'): Promise<void> {
  if (source === 'local') { writeLocal(readLocal().filter((p) => p.id !== id)); return; }
  const r = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(String(r.status));
}

/** Drop components with unknown types (e.g. from a newer app version) and dangling wires. */
export function sanitize(c: Circuit | null | undefined): Circuit {
  const comps = (c?.components ?? []).filter((x) => hasDef(x.type));
  const ids = new Set(comps.map((x) => x.id));
  const wires = (c?.wires ?? []).filter((w) => ids.has(w.a.comp) && ids.has(w.b.comp));
  const faults = Object.fromEntries(Object.entries(c?.faults ?? {}).filter(([id]) => ids.has(id)));
  const firmware = Object.fromEntries(Object.entries(c?.firmware ?? {}).filter(([id]) => ids.has(id)));
  return { components: comps, wires, faults, ambient: c?.ambient, firmware, pcb: c?.pcb };
}

export function autosave(name: string, circuit: Circuit): void {
  try { localStorage.setItem(LS_AUTOSAVE, JSON.stringify({ name, circuit })); } catch { /* quota */ }
}
export function readAutosave(): { name: string; circuit: Circuit } | null {
  try {
    const raw = localStorage.getItem(LS_AUTOSAVE);
    if (!raw) return null;
    const p = JSON.parse(raw) as { name: string; circuit: Circuit };
    return { name: p.name, circuit: sanitize(p.circuit) };
  } catch { return null; }
}

export function download(filename: string, text: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const toProjectFile = (name: string, circuit: Circuit): string =>
  JSON.stringify({ format: 'electrolab-project', version: 1, name, circuit } satisfies ProjectFile, null, 2);

export function parseProjectFile(text: string): { name: string; circuit: Circuit } {
  const p = JSON.parse(text) as Partial<ProjectFile>;
  if (p.format !== 'electrolab-project' || !p.circuit) throw new Error('Geçersiz proje dosyası');
  return { name: p.name ?? 'İçe aktarılan proje', circuit: sanitize(p.circuit) };
}

/** Bill of materials. Only values we actually hold are filled; manufacturer data is marked missing. */
export function bomCsv(circuit: Circuit): string {
  const rows = [['Ref', 'Tür', 'Değer / parametreler', 'Üretici', 'Model no', 'Datasheet', 'Not']];
  for (const c of [...circuit.components].sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))) {
    if (getDef(c.type).model === 'ground') continue;
    const def = getDef(c.type);
    const vals = def.params
      .filter((p) => p.type === 'number' && ['r', 'c', 'l', 'v', 'vz', 'i', 'amp', 'freq'].includes(p.key))
      .map((p) => `${p.label}=${p.si ? formatSI(Number(c.params[p.key]), p.unit) : c.params[p.key]}`)
      .join('; ');
    rows.push([c.ref, def.name, vals, 'EKSİK', 'EKSİK', def.datasheet ?? 'EKSİK', def.dataSource === 'generic-model' ? 'Genel model, belirli bir üretici parçası değil' : '']);
  }
  return rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}
