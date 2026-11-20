import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { useLab } from './store/lab';
import { Lab } from './ui/Lab';
import { LibraryPage } from './ui/LibraryPage';
import { McuLab } from './ui/McuLab';
import { Schematic } from './ui/Schematic';
import { Pcb } from './ui/Pcb';
import { Home, Planned, Projects, Settings, SimCenter } from './ui/Pages';
import { Academy, LessonPage, Notebook } from './ui/Education';

function App() {
  const view = useLab((s) => s.view);
  return (
    <div className="h-full bg-zinc-950 text-zinc-200">
      {view === 'home' && <Home />}
      {view === 'lab' && <Lab />}
      {view === 'library' && <LibraryPage />}
      {view === 'mculab' && <McuLab />}
      {view === 'schematic' && <Schematic />}
      {view === 'pcb' && <Pcb />}
      {view === 'academy' && <Academy />}
      {view === 'lesson' && <LessonPage />}
      {view === 'notebook' && <Notebook />}
      {view === 'projects' && <Projects />}
      {view === 'simcenter' && <SimCenter />}
      {view === 'settings' && <Settings />}
      {view === 'planned' && <Planned />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
