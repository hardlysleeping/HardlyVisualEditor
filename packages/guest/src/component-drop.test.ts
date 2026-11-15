import { describe, expect, it } from 'vitest';
import { buildDropOperations, isDroppableComponent, type DroppableComponent } from './component-drop.js';

const component: DroppableComponent = {
  id: 'saved-1', name: 'Playback controls', tag: 'div', text: 'Controls',
  class_names: ['controls'], styles: [['display', 'flex']],
  children: [{ tag: 'button', text: 'Play', class_names: ['btn'], styles: [['padding', '8px']], children: [] }],
};

describe('saved component drag/drop', () => {
  it('accepts the supported saved component tree and rejects unsafe nodes', () => {
    expect(isDroppableComponent(component)).toBe(true);
    expect(isDroppableComponent({ ...component, children: [{ ...component, tag: 'script' }] })).toBe(false);
    expect(isDroppableComponent({ ...component, styles: [['background', 'url(x);color:red']] })).toBe(false);
  });

  it('builds a single insertable tree with unique reversible identities', () => {
    const parent = {
      webview_id: 'main', inspector_id: null, html_id: 'layout',
      semantic_selector: 'main#layout', generated_id: null,
    };
    const operations = buildDropOperations(component, parent, 'My controls');
    expect(operations).toHaveLength(4);
    const inserts = operations.filter((operation) => operation.operation === 'insert_element');
    expect(inserts[0]).toMatchObject({ tag: 'div', text: 'My controls', parent });
    expect(inserts[1]).toMatchObject({ tag: 'button', text: 'Play' });
    expect(inserts[0].identity.generated_id).not.toBe(inserts[1].identity.generated_id);
    expect(inserts[0].identity.generated_id).not.toBe(parent.generated_id);
  });
});
