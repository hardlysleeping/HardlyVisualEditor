import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextPanel } from './ContextPanel.js';
import * as client from './client.js';

vi.mock('./client.js', () => ({
  removeCapture: vi.fn(),
  removeElement: vi.fn(),
}));

const removeCapture = vi.mocked(client.removeCapture);

let container: HTMLDivElement;
let root: Root;

const capture = {
  id: 'cap-1',
  path: '/tmp/cap-1.png',
  capture_type: 'webview',
  include_in_copy: true,
};

async function renderPanel() {
  await act(async () => {
    root.render(
      <ContextPanel
        elements={[]}
        captures={[capture]}
        issueText=""
        busy={false}
        message={null}
        onIssueChange={() => undefined}
        onCopy={() => undefined}
        onClear={() => undefined}
      />,
    );
  });
}

function removeButton(): HTMLButtonElement {
  const node = container.querySelector('[data-ve-chip-remove]');
  if (!(node instanceof HTMLButtonElement)) throw new Error('chip remove button not rendered');
  return node;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('ContextPanel chip removal', () => {
  it('names what the remove button removes', async () => {
    await renderPanel();
    expect(removeButton().getAttribute('aria-label')).toBe('Remove screenshot chip');
  });

  it('calls remove_capture for that chip', async () => {
    removeCapture.mockResolvedValueOnce(undefined);
    await renderPanel();
    await act(async () => {
      removeButton().click();
    });
    expect(removeCapture).toHaveBeenCalledWith('cap-1');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('explains a refusal instead of swallowing it', async () => {
    removeCapture.mockRejectedValueOnce(new Error('Unknown capture: cap-1'));
    await renderPanel();
    await act(async () => {
      removeButton().click();
    });
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('That item is no longer in the selection');
    expect(alert?.textContent).toContain('Close and reopen the inspector');
  });

  it('clears the notice when a later removal works', async () => {
    removeCapture.mockRejectedValueOnce(new Error('Unknown capture: cap-1'));
    await renderPanel();
    await act(async () => {
      removeButton().click();
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    removeCapture.mockResolvedValueOnce(undefined);
    await act(async () => {
      removeButton().click();
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});