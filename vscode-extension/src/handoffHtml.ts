import type { HandoffView } from './readModelClient';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character] ?? character));
}

function list(title: string, items: string[]): string {
  return `<section><h3>${escapeHtml(title)}</h3>${items.length === 0
    ? '<p class="muted">None recorded.</p>'
    : `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`}</section>`;
}

export function renderHandoffHtml(view: HandoffView | null, state: { busy: boolean; error: string | null; message: string | null } = { busy: false, error: null, message: null }): string {
  if (view === null) return '<!doctype html><html><body><h2>Handoff</h2><p>Loading handoff context…</p></body></html>';
  const sourceModel = view.source.session.binding.modelRef ?? view.source.session.binding.modelId ?? 'runtime default';
  const selected = view.preview?.targetModel.modelRef ?? '';
  const options = view.models.map((model) => `<option value="${escapeHtml(model.modelRef)}" ${model.modelRef === selected ? 'selected' : ''} ${!model.available && !model.configured ? 'disabled' : ''}>${escapeHtml(model.providerId)} / ${escapeHtml(model.displayName)} — ${escapeHtml(model.availability)}</option>`).join('');
  const continuation = view.preview?.continuation;
  const preview = continuation === undefined ? '<p class="muted">Select an available target model to load the bounded continuation preview.</p>' : [
    list('Observed completed', continuation.observedCompleted),
    list('Observed partial', continuation.observedPartial),
    list('Decisions / constraints', [...continuation.decisions, ...continuation.constraints]),
    list('Checkpoint', continuation.checkpointNotes),
    list('Changed / relevant files', continuation.changedFiles),
    list('Validation evidence', continuation.validationEvidence),
    list('Acceptance requiring verification', continuation.acceptanceRequiringVerification),
    list('Known blockers', continuation.knownBlockers),
    `<section><h3>Immediate continuation</h3><p>${escapeHtml(continuation.immediateNextAction)}</p></section>`,
  ].join('');
  const result = view.result === null ? '' : `<section class="success"><h3>Handoff complete</h3><p>Task ${escapeHtml(view.result.handoff.taskId)} · ${escapeHtml(view.result.handoff.status)}</p><p><strong>${escapeHtml(view.source.session.binding.modelRef ?? sourceModel)}</strong> · session ${escapeHtml(view.result.handoff.sourceExecutionSessionId)}</p><p class="arrow">↓ Handoff</p><p><strong>${escapeHtml(view.result.target.session.binding.modelRef ?? 'runtime default')}</strong> · session ${escapeHtml(view.result.handoff.targetExecutionSessionId)}</p><p>Created ${escapeHtml(view.result.handoff.createdAt)}</p><p>Target status: ${escapeHtml(view.result.target.session.status)}</p></section>`;
  const error = state.error === null ? '' : `<p class="error">${escapeHtml(state.error)}</p>`;
  const message = state.message === null ? '' : `<p class="message">${escapeHtml(state.message)}</p>`;
  const disabled = state.busy || continuation === undefined || view.result !== null;
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"><style>
    body{font:13px var(--vscode-font-family);color:var(--vscode-foreground);padding:12px;line-height:1.45}h2{margin-top:0}h3{font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px}section{border-top:1px solid var(--vscode-panel-border);padding:10px 0}ul{margin:0;padding-left:20px}.muted{color:var(--vscode-descriptionForeground)}.error{color:var(--vscode-errorForeground);padding:8px;background:var(--vscode-inputValidation-errorBackground)}.message{color:var(--vscode-testing-iconPassed)}.source{display:grid;grid-template-columns:100px 1fr;gap:2px 8px}.arrow{text-align:center;font-size:18px}.success{border:1px solid var(--vscode-testing-iconPassed);padding:10px}.actions{display:flex;gap:8px;position:sticky;bottom:0;background:var(--vscode-sideBar-background);padding-top:10px}button{padding:5px 10px}select{width:100%;padding:5px;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border)}
  </style></head><body><h2>Handoff review</h2><section><h3>Source</h3><div class="source"><span>Runtime</span><strong>${escapeHtml(view.source.session.runtime)}</strong><span>Provider/model</span><strong>${escapeHtml(sourceModel)}</strong><span>Session</span><strong>${escapeHtml(view.source.session.id)}</strong><span>Status</span><strong>${escapeHtml(view.source.session.status)}</strong><span>Task</span><strong>${escapeHtml(view.source.task.id ?? 'unassigned')} · ${escapeHtml(view.source.task.objective)}</strong></div></section><section><h3>Target OpenCode model</h3><select id="model" ${state.busy || view.result !== null ? 'disabled' : ''}><option value="">Choose a model…</option>${options}</select>${view.discoveryWarning === null ? '' : `<p class="muted">${escapeHtml(view.discoveryWarning)}</p>`}</section><section><h3>Continuation review</h3>${preview}</section>${result}${error}${message}<div class="actions"><button id="cancel">Cancel</button><button id="confirm" ${disabled ? 'disabled' : ''}>${state.busy ? 'Creating target session…' : 'Confirm Handoff'}</button></div><script>
    const vscode=acquireVsCodeApi(); const model=document.getElementById('model'); const confirm=document.getElementById('confirm');
    model?.addEventListener('change',()=>vscode.postMessage({type:'target',modelRef:model.value})); confirm?.addEventListener('click',()=>vscode.postMessage({type:'confirm'})); document.getElementById('cancel')?.addEventListener('click',()=>vscode.postMessage({type:'cancel'}));
  </script></body></html>`;
}
