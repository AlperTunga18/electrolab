import { create } from 'zustand';
import { LESSONS } from './content';
import { TRACK_LABEL, type Track } from './types';

export interface LessonProgress {
  opened?: boolean;
  quiz?: { score: number; total: number };
  challenge?: boolean;
  hunt?: boolean;
  done?: boolean;
  at?: string;
}

export interface NotebookEntry {
  id: string;
  at: string;
  lesson?: string;
  title: string;
  note: string;
  /** measurement snapshot lines, e.g. "R2: 6.667 V" */
  data: string[];
}

interface ProgressState {
  lessons: Record<string, LessonProgress>;
  notebook: NotebookEntry[];
  open: (id: string) => void;
  setQuiz: (id: string, score: number, total: number) => void;
  setChallenge: (id: string) => void;
  setHunt: (id: string) => void;
  addNote: (e: Omit<NotebookEntry, 'id' | 'at'>) => void;
  deleteNote: (id: string) => void;
  reset: () => void;
}

const KEY = 'electrolab.progress';
const load = (): Pick<ProgressState, 'lessons' | 'notebook'> => {
  try { const p = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (p) return { lessons: p.lessons ?? {}, notebook: p.notebook ?? [] }; } catch { /* no storage */ }
  return { lessons: {}, notebook: [] };
};

export const PASS_RATIO = 0.7;

/** a lesson counts as done once its quiz is passed (and, where present, the challenge / fault hunt are solved). */
export function isDone(id: string, p: LessonProgress | undefined): boolean {
  const l = LESSONS.find((x) => x.id === id);
  if (!l || !p?.quiz) return false;
  if (p.quiz.score / p.quiz.total < PASS_RATIO) return false;
  if (l.challenge && !p.challenge) return false;
  if (l.faultHunt && !p.hunt) return false;
  return true;
}

export const useProgress = create<ProgressState>((set, get) => {
  const save = () => { try { const { lessons, notebook } = get(); localStorage.setItem(KEY, JSON.stringify({ lessons, notebook })); } catch { /* ignore */ } };
  const patch = (id: string, f: (p: LessonProgress) => LessonProgress) => {
    const cur = get().lessons[id] ?? {};
    const next = f(cur);
    next.done = isDone(id, next);
    if (next.done && !cur.done) next.at = new Date().toISOString();
    set({ lessons: { ...get().lessons, [id]: next } });
    save();
  };
  return {
    ...load(),
    open: (id) => patch(id, (p) => ({ ...p, opened: true })),
    setQuiz: (id, score, total) => patch(id, (p) => ({ ...p, quiz: !p.quiz || score / total >= p.quiz.score / p.quiz.total ? { score, total } : p.quiz })),
    setChallenge: (id) => patch(id, (p) => ({ ...p, challenge: true })),
    setHunt: (id) => patch(id, (p) => ({ ...p, hunt: true })),
    addNote: (e) => { set({ notebook: [{ ...e, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString() }, ...get().notebook] }); save(); },
    deleteNote: (id) => { set({ notebook: get().notebook.filter((n) => n.id !== id) }); save(); },
    reset: () => { set({ lessons: {}, notebook: [] }); save(); },
  };
});

export interface Stats { points: number; level: number; doneCount: number; total: number }

export function stats(lessons: Record<string, LessonProgress>): Stats {
  let points = 0, doneCount = 0;
  for (const l of LESSONS) {
    const p = lessons[l.id];
    if (!p) continue;
    if (p.quiz) points += Math.round((p.quiz.score / p.quiz.total) * 10);
    if (p.challenge) points += 30;
    if (p.hunt) points += 30;
    if (p.done) { points += 20; doneCount++; }
  }
  return { points, level: Math.floor(points / 100) + 1, doneCount, total: LESSONS.length };
}

export interface Badge { id: string; label: string; desc: string; earned: boolean }

export function badges(lessons: Record<string, LessonProgress>, noteCount: number): Badge[] {
  const done = (t: Track) => LESSONS.filter((l) => l.track === t && lessons[l.id]?.done).length;
  const all = (t: Track) => LESSONS.filter((l) => l.track === t);
  const hunts = LESSONS.filter((l) => lessons[l.id]?.hunt).length;
  const chal = LESSONS.filter((l) => lessons[l.id]?.challenge).length;
  const perfect = LESSONS.filter((l) => lessons[l.id]?.quiz && lessons[l.id]!.quiz!.score === lessons[l.id]!.quiz!.total).length;
  const out: Badge[] = [
    { id: 'first', label: 'İlk adım', desc: 'İlk dersi tamamla', earned: Object.values(lessons).some((p) => p.done) },
    { id: 'chal3', label: 'Mühendis çırağı', desc: '3 görev çöz', earned: chal >= 3 },
    { id: 'hunt3', label: 'Arıza avcısı', desc: '3 arıza avı çöz', earned: hunts >= 3 },
    { id: 'perfect3', label: 'Tam puan', desc: '3 testte %100 al', earned: perfect >= 3 },
    { id: 'notes', label: 'Laboratuvar defteri', desc: 'Deney defterine 3 kayıt ekle', earned: noteCount >= 3 },
  ];
  for (const t of Object.keys(TRACK_LABEL) as Track[]) out.push({ id: `track-${t}`, label: `${TRACK_LABEL[t]} ustası`, desc: `“${TRACK_LABEL[t]}” parkurunun tüm derslerini bitir`, earned: all(t).length > 0 && done(t) === all(t).length });
  return out;
}
