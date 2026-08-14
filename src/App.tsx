import { useState, useEffect } from 'react';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { OnboardingWizard } from './screens/OnboardingWizard';
import { CompilerScreen } from './screens/CompilerScreen';
import { ResultScreen } from './screens/ResultScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { HandoffView } from './components/HandoffView';
import { SessionsScreen } from './screens/SessionsScreen';
import { reconcileAllProjects } from './sessions/executionSessionService';
import type { TaskSpec } from './schemas/taskspec';
import { PROFILES } from './profiles/registry';
import { getActiveProjectId } from './services/projectsService';
import { processVscodeSessionAction } from './services/vscodeIntegration';

type ScreenId = 'projects' | 'settings' | 'onboarding' | 'compiler' | 'result' | 'history' | 'handoff' | 'sessions';

function tabClass(active: boolean): string {
  return `rounded-md px-3 py-1 text-sm font-medium ${
    active ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'
  }`;
}

export default function App() {
  const [screen, setScreen] = useState<ScreenId>('projects');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [handoffProjectName, setHandoffProjectName] = useState('');
  const [compilerPrefill, setCompilerPrefill] = useState('');
  const taskSpec: TaskSpec | null = null;
  const contextSent = '';
  const rawRequest = '';
  const activeProfile = PROFILES['deepseek-v4-pro-claude-code'] ?? null;

  useEffect(() => {
    getActiveProjectId().then((id) => { if (id) setActiveProjectId(id); }).catch(() => {});
    void reconcileAllProjects();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => { void processVscodeSessionAction().catch(() => {}); }, 500);
    return () => window.clearInterval(timer);
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
                  onClick={() => { if (id === 'compiler') setCompilerPrefill(''); setScreen(id); }}
                  aria-pressed={screen === id}
                  className={tabClass(screen === id)}
                >
                  {id === 'projects' ? 'Projects' : id === 'compiler' ? 'Compiler' : id === 'history' ? 'History' : 'Settings'}
                </button>
              ))}
            </nav>
          </div>
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
            onSessions={(projectId, projectName) => {
              setActiveProjectId(projectId);
              setHandoffProjectName(projectName);
              setScreen('sessions');
            }}
            onActiveChanged={(projectId) => setActiveProjectId(projectId)}
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
            activeProjectId={activeProjectId}
            initialRequest={compilerPrefill}
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
            onSessions={(projectId, projectName) => {
              setActiveProjectId(projectId);
              setHandoffProjectName(projectName);
              setScreen('sessions');
            }}
            onCompiler={(projectId, prefill) => {
              setActiveProjectId(projectId);
              setCompilerPrefill(prefill);
              setScreen('compiler');
            }}
          />
        )}
        {screen === 'sessions' && activeProjectId && (
          <SessionsScreen
            projectId={activeProjectId}
            projectName={handoffProjectName || activeProjectId}
            onClose={() => setScreen('projects')}
          />
        )}
      </main>
    </div>
  );
}
