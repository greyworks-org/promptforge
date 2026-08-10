import { useState, useEffect } from 'react';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { OnboardingWizard } from './screens/OnboardingWizard';
import { CompilerScreen } from './screens/CompilerScreen';
import { ResultScreen } from './screens/ResultScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { HandoffView } from './components/HandoffView';
import type { TaskSpec } from './schemas/taskspec';
import type { ProviderProfile } from './schemas/providerProfile';
import { PROFILES } from './profiles/registry';
import { loadProfile } from './services/settingsService';

type ScreenId = 'projects' | 'settings' | 'onboarding' | 'compiler' | 'result' | 'history' | 'handoff';

function tabClass(active: boolean): string {
  return `rounded-md px-3 py-1 text-sm font-medium ${
    active ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'
  }`;
}

export default function App() {
  const [screen, setScreen] = useState<ScreenId>('projects');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [handoffProjectName, setHandoffProjectName] = useState('');
  const taskSpec: TaskSpec | null = null;
  const contextSent = '';
  const rawRequest = '';
  const activeProfile = PROFILES['deepseek-v4-pro-claude-code'] ?? null;
  const [providerProfile, setProviderProfile] = useState<ProviderProfile | null>(null);

  useEffect(() => {
    loadProfile().then(setProviderProfile).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div className="flex items-center gap-5">
            <h1 className="text-lg font-semibold tracking-tight">PromptForge Local</h1>
            <nav className="flex gap-1" aria-label="Screens">
              {(['projects', 'compiler', 'history', 'settings'] as ScreenId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setScreen(id)}
                  aria-pressed={screen === id}
                  className={tabClass(screen === id)}
                >
                  {id === 'projects' ? 'Projects' : id === 'compiler' ? 'Compiler' : id === 'history' ? 'History' : 'Settings'}
                </button>
              ))}
            </nav>
          </div>
          <span className="text-xs text-zinc-500">MVP · All phases</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">
        {screen === 'projects' && (
          <ProjectsScreen
            onStartOnboarding={(projectId) => {
              if (projectId) setActiveProjectId(projectId);
              setScreen('onboarding');
            }}
            onContinue={(projectId, projectName) => {
              setActiveProjectId(projectId);
              setHandoffProjectName(projectName);
              setScreen('handoff');
            }}
          />
        )}
        {screen === 'settings' && <SettingsScreen />}
        {screen === 'onboarding' && (
          <OnboardingWizard
            existingProjectId={activeProjectId}
            onComplete={(pid) => { setActiveProjectId(pid); setScreen('projects'); }}
          />
        )}
        {screen === 'compiler' && (
          <CompilerScreen
            activeProfile={providerProfile}
            activeProjectId={activeProjectId}
          />
        )}
        {screen === 'result' && taskSpec && activeProfile && (
          <ResultScreen
            taskSpec={taskSpec}
            profile={activeProfile}
            contextSent={contextSent}
            rawRequest={rawRequest}
            onEdit={() => setScreen('compiler')}
            onRecompile={() => setScreen('compiler')}
          />
        )}
        {screen === 'result' && !taskSpec && (
          <p className="text-sm text-zinc-500">No compiled task yet. Go to Compiler first.</p>
        )}
        {screen === 'history' && activeProjectId && (
          <HistoryScreen projectId={activeProjectId} />
        )}
        {screen === 'history' && !activeProjectId && (
          <p className="text-sm text-zinc-500">Select a project first.</p>
        )}
        {screen === 'handoff' && activeProjectId && (
          <HandoffView
            projectId={activeProjectId}
            projectName={handoffProjectName || activeProjectId}
            onClose={() => setScreen('projects')}
          />
        )}
      </main>
    </div>
  );
}
