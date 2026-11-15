import { beforeEach, describe, expect, it } from 'vitest';
import { applyStyleOperation, type SetStyleOperation, type SetTextBindingOperation } from './editing.js';

const identity: SetStyleOperation['identity'] = {
  webview_id: 'main',
  inspector_id: 'player.queue',
  html_id: 'queue',
  semantic_selector: 'button:nth-child(2)',
  generated_id: null,
};

function operation(after: string | null): SetStyleOperation {
  return {
    operation: 'set_style',
    identity,
    property: 'width',
    before: '55px',
    after,
  };
}

describe('applyStyleOperation', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="queue" data-inspector-id="player.queue"></button>';
  });

  it('updates the real selected element by its stable inspector identity', () => {
    const button = document.querySelector('button')!;
    expect(applyStyleOperation(operation('44px'))).toBe(true);
    expect(button.style.width).toBe('44px');
  });

  it('uses the HTML id fallback and reverses to the before value', () => {
    const button = document.querySelector('button')!;
    button.removeAttribute('data-inspector-id');
    expect(applyStyleOperation(operation('44px'))).toBe(true);
    expect(applyStyleOperation(operation('44px'), true)).toBe(true);
    expect(button.style.width).toBe('55px');
  });

  it('removes a width declaration when restoring an unset value', () => {
    const button = document.querySelector('button')!;
    expect(applyStyleOperation(operation(null))).toBe(true);
    expect(button.style.width).toBe('');
  });

  it('rejects invalid values and missing identities', () => {
    expect(applyStyleOperation(operation('44px; color:red'))).toBe(false);
    expect(
      applyStyleOperation({
        ...operation('44px'),
        identity: { ...identity, inspector_id: null, html_id: null },
      }),
    ).toBe(false);
  });

  it('binds a leaf text value to a live source and reverses cleanly', async () => {
    document.body.innerHTML = '<button data-inspector-id="source">Chapter one</button><p data-inspector-id="target">Fallback</p>';
    const binding: SetTextBindingOperation = {
      operation: 'set_text_binding',
      identity: { webview_id: 'main', inspector_id: 'target', html_id: null, semantic_selector: null, generated_id: null },
      before: null,
      after: { webview_id: 'main', inspector_id: 'source', html_id: null, semantic_selector: null, generated_id: null },
      before_text: 'Fallback',
    };
    const target = document.querySelector('p')!;
    const source = document.querySelector('button')!;
    expect(applyStyleOperation(binding)).toBe(true);
    expect(target.textContent).toBe('Chapter one');

    source.textContent = 'Chapter two';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(target.textContent).toBe('Chapter two');

    expect(applyStyleOperation(binding, true)).toBe(true);
    expect(target.textContent).toBe('Fallback');
    expect(target.hasAttribute('data-hardlyui-bind-text')).toBe(false);
    expect(applyStyleOperation(binding)).toBe(true);
    expect(target.textContent).toBe('Chapter two');
  });

  it('rejects text-binding cycles', () => {
    document.body.innerHTML = '<p data-inspector-id="first">A</p><p data-inspector-id="second">B</p>';
    const first = { webview_id: 'main', inspector_id: 'first', html_id: null, semantic_selector: null, generated_id: null };
    const second = { webview_id: 'main', inspector_id: 'second', html_id: null, semantic_selector: null, generated_id: null };
    const firstToSecond: SetTextBindingOperation = { operation: 'set_text_binding', identity: first, before: null, after: second, before_text: 'A' };
    const secondToFirst: SetTextBindingOperation = { operation: 'set_text_binding', identity: second, before: null, after: first, before_text: 'B' };
    expect(applyStyleOperation(firstToSecond)).toBe(true);
    expect(applyStyleOperation(secondToFirst)).toBe(false);
  });

  it('follows form-source input events', () => {
    document.body.innerHTML = '<input data-inspector-id="source" value="one"><p data-inspector-id="target">old</p>';
    const binding: SetTextBindingOperation = {
      operation: 'set_text_binding',
      identity: { webview_id: 'main', inspector_id: 'target', html_id: null, semantic_selector: null, generated_id: null },
      before: null,
      after: { webview_id: 'main', inspector_id: 'source', html_id: null, semantic_selector: null, generated_id: null },
      before_text: 'old',
    };
    expect(applyStyleOperation(binding)).toBe(true);
    const source = document.querySelector('input')!;
    source.value = 'two';
    source.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('p')?.textContent).toBe('two');
  });

  it('edits one text node inside an element that has children', () => {
    document.body.innerHTML = '<h2 data-inspector-id="heading">Chapter <span>one</span> continues</h2>';
    const heading = document.querySelector('h2')!;
    const edit = (index: number, after: string) => ({
      operation: 'set_text' as const,
      identity: { webview_id: 'main', inspector_id: 'heading', html_id: null, semantic_selector: null, generated_id: null },
      before: index === 0 ? 'Chapter ' : ' continues',
      after,
      text_index: index,
    });
    // Index 0 is the run before the <span>, index 1 the run after it.
    expect(applyStyleOperation(edit(0, 'Prologue '))).toBe(true);
    expect(heading.children).toHaveLength(1);
    expect(heading.querySelector('span')?.textContent).toBe('one');
    expect(heading.textContent).toBe('Prologue one continues');

    expect(applyStyleOperation(edit(1, ', again'))).toBe(true);
    expect(heading.textContent).toBe('Prologue one, again');
    expect(heading.querySelector('span')?.textContent).toBe('one');

    // Undo restores only the node it changed.
    expect(applyStyleOperation(edit(1, ', again'), true)).toBe(true);
    expect(heading.textContent).toBe('Prologue one continues');
    expect(applyStyleOperation(edit(0, 'Prologue '), true)).toBe(true);
    expect(heading.textContent).toBe('Chapter one continues');
    expect(heading.children).toHaveLength(1);
  });

  it('refuses a text index the element does not have', () => {
    document.body.innerHTML = '<p data-inspector-id="solo">Only</p>';
    const identity = { webview_id: 'main', inspector_id: 'solo', html_id: null, semantic_selector: null, generated_id: null };
    expect(applyStyleOperation({ operation: 'set_text', identity, before: 'Only', after: 'Changed', text_index: 1 })).toBe(false);
    expect(document.querySelector('p')?.textContent).toBe('Only');
  });

  it('edits a plain leaf without a text index', () => {
    document.body.innerHTML = '<p data-inspector-id="leaf">Old</p>';
    const identity = { webview_id: 'main', inspector_id: 'leaf', html_id: null, semantic_selector: null, generated_id: null };
    expect(applyStyleOperation({ operation: 'set_text', identity, before: 'Old', after: 'New' })).toBe(true);
    expect(document.querySelector('p')?.textContent).toBe('New');
    expect(applyStyleOperation({ operation: 'set_text', identity, before: 'Old', after: 'New' }, true)).toBe(true);
    expect(document.querySelector('p')?.textContent).toBe('Old');
  });
});
