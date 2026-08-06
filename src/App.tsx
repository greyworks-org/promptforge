import { SettingsScreen } from './screens/SettingsScreen';

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-baseline justify-between">
          <h1 className="text-lg font-semibold tracking-tight">PromptForge Local</h1>
          <span className="text-xs text-zinc-500">Phase 1 · Provider settings</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">
        <SettingsScreen />
      </main>
    </div>
  );
}
