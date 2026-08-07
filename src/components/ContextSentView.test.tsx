import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextSentView } from './ContextSentView';
import type { AssembledPayload } from '../services/payloadAssembly';

function makePayload(overrides: Partial<AssembledPayload> = {}): AssembledPayload {
  return {
    text: 'Add a login page\n\n# Product\nThis is a test product.',
    estTokens: 12,
    report: {
      timestamp: '2026-08-07T00:00:00Z',
      totalRedacted: 0,
      entries: [],
      entropyWarnings: [],
      summary: 'No secrets detected.',
    },
    blockedFiles: [],
    hasContent: true,
    ...overrides,
  };
}

describe('ContextSentView', () => {
  it('renders payload text', () => {
    render(
      <ContextSentView
        payload={makePayload()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/Add a login page/)).toBeTruthy();
  });

  it('shows token estimate', () => {
    render(
      <ContextSentView
        payload={makePayload({ estTokens: 42 })}
        onSend={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('shows redacted count', () => {
    render(
      <ContextSentView
        payload={makePayload({
          report: {
            timestamp: '',
            totalRedacted: 3,
            entries: [
              { file: 'a', line: 1, class: 'jwt' },
              { file: 'b', line: 2, class: 'api-key' },
              { file: 'c', line: 3, class: 'aws-access-key' },
            ],
            entropyWarnings: [],
            summary: '3 secrets redacted',
          },
        })}
        onSend={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText(/secrets redacted/)).toBeTruthy();
  });

  it('shows redaction details', () => {
    render(
      <ContextSentView
        payload={makePayload({
          report: {
            timestamp: '',
            totalRedacted: 1,
            entries: [{ file: 'test.env', line: 3, class: 'aws-access-key' }],
            entropyWarnings: [],
            summary: '1 secret redacted',
          },
        })}
        onSend={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/test.env:3/)).toBeTruthy();
    expect(screen.getByText(/aws-access-key/)).toBeTruthy();
  });

  it('shows blocked files', () => {
    render(
      <ContextSentView
        payload={makePayload({ blockedFiles: ['.env', 'server.key'] })}
        onSend={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('.env')).toBeTruthy();
    expect(screen.getByText('server.key')).toBeTruthy();
  });

  it('shows entropy warnings', () => {
    render(
      <ContextSentView
        payload={makePayload({
          report: {
            timestamp: '',
            totalRedacted: 0,
            entries: [],
            entropyWarnings: [
              { file: 'test', line: 5, snippet: 'aB3d...xyz==' },
            ],
            summary: '1 high-entropy warning',
          },
        })}
        onSend={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/High-entropy content/)).toBeTruthy();
    expect(screen.getByText(/aB3d...xyz==/)).toBeTruthy();
  });

  it('calls onSend when Send button clicked', () => {
    const onSend = vi.fn();
    render(
      <ContextSentView
        payload={makePayload()}
        onSend={onSend}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Send'));
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('calls onCancel when Cancel button clicked', () => {
    const onCancel = vi.fn();
    render(
      <ContextSentView
        payload={makePayload()}
        onSend={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('disables Send when hasContent is false', () => {
    render(
      <ContextSentView
        payload={makePayload({ hasContent: false, text: '' })}
        onSend={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const sendButton = screen.getByText('Send') as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
    expect(screen.getByText(/No content to send/)).toBeTruthy();
  });

  it('shows empty state when no content', () => {
    render(
      <ContextSentView
        payload={makePayload({ hasContent: false, text: '' })}
        onSend={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/no content to send/)).toBeTruthy();
  });

  it('cancel does not trigger send', () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    render(
      <ContextSentView
        payload={makePayload()}
        onSend={onSend}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onSend).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
