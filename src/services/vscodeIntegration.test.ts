import { describe, expect, it } from 'vitest';
import {
  formatVscodeConnection,
  parseVscodeConnection,
  type VscodeConnection,
} from './vscodeIntegration';

describe('VS Code read-model connection', () => {
  const connection: VscodeConnection = {
    endpoint: 'http://127.0.0.1:43127',
    token: 'local-token',
    projectId: 'project-1',
    sessionId: 'session-1',
  };

  it('round-trips a loopback connection URI', () => {
    expect(parseVscodeConnection(formatVscodeConnection(connection))).toEqual(connection);
  });

  it('rejects non-loopback endpoints', () => {
    expect(parseVscodeConnection('promptforge://connect?endpoint=https%3A%2F%2Fevil.example&token=x&projectId=p&sessionId=s')).toBeNull();
  });
});
