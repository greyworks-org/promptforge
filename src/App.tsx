import { useState } from 'react';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { SettingsScreen } from './screens/SettingsScreen';

type ScreenId = 'projects' | 'settings';

function tabClass(active: boolean): string {
  return `rounded-md px-3 py-1 text-sm font-medium ${
    active ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'
  }`;
}

export default function App() {
  const [screen, setScreen] = useState<ScreenId>('projects');

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div className="flex items-center gap-5">
            <h1 className="text-lg font-semibold tracking-tight">PromptForge Local</h1>
            <nav className="flex gap-1" aria-label="Screens">
              <button
                type="button"
                onClick={() => setScreen('projects')}
                aria-pressed={screen === 'projects'}
                className={tabClass(screen === 'projects')}
              >
                Projects
              </button>
              <button
                type="button"
                onClick={() => setScreen('settings')}
                aria-pressed={screen === 'settings'}
                className={tabClass(screen === 'settings')}
              >
                Settings
              </button>
            </nav>
          </div>
          <span className="text-xs text-zinc-500">Phase 2 · Projects & settings</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">
        {screen === 'projects' ? <ProjectsScreen /> : <SettingsScreen />}
      </main>
    </div>
  );
}
