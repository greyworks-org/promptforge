import { fileExists, listDirectory } from './projectFs';

export interface GuidanceEntry {
  kind: 'rule' | 'skill';
  path: string;
  name: string;
}

const RULE_FILES = ['AGENTS.md', 'CLAUDE.md', 'QWEN.md', 'CODEX.md'];
const RULE_DIRECTORIES = ['.claude/rules', '.codex/rules', '.qwen/rules'];
const SKILL_DIRECTORIES = ['.claude/skills', '.codex/skills', '.qwen/skills', '.promptforge/skills', 'skills'];

/** Read-only inventory of project guidance visible to the active session. */
export async function inspectProjectGuidance(projectId: string): Promise<GuidanceEntry[]> {
  const entries: GuidanceEntry[] = [];
  for (const path of RULE_FILES) {
    try {
      if (await fileExists(projectId, path)) entries.push({ kind: 'rule', path, name: path });
    } catch { /* missing guidance is normal */ }
  }
  for (const path of RULE_DIRECTORIES) {
    try {
      const files = await listDirectory(projectId, path);
      for (const file of files.filter((item) => !item.isDir)) {
        entries.push({ kind: 'rule', path: `${path}/${file.name}`, name: file.name });
      }
    } catch { /* optional runtime directories */ }
  }
  for (const path of SKILL_DIRECTORIES) {
    try {
      const files = await listDirectory(projectId, path);
      for (const file of files) {
        entries.push({ kind: 'skill', path: `${path}/${file.name}`, name: file.name });
      }
    } catch { /* optional skill directories */ }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
