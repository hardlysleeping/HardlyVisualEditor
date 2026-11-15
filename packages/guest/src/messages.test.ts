import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { explainError, explainErrorLine, userMessage } from './messages.js';

const rulesBlock = (path: string): string => {
  const source = readFileSync(path, 'utf8');
  const start = source.indexOf('const RULES: Rule[] = [');
  const end = source.indexOf('\n];', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe('guest message rules', () => {
  it('stays in step with the inspector copy', () => {
    // The injected toolbar ships into any host page on its own, so it carries
    // its own copy. Rewording one without the other is what this guards.
    const inspector = rulesBlock(
      join(__dirname, '../../inspector-app/src/lib/messages.ts'),
    );
    expect(rulesBlock(join(__dirname, 'messages.ts'))).toBe(inspector);
  });

  it('explains a chip that outlived its capture', () => {
    const explained = explainError(new Error('Unknown capture: cap-1'));
    expect(explained.title).toBe('That item is no longer in the selection');
    expect(explained.action).not.toBe('');
  });

  it('has a one-line form for the toolbar status', () => {
    expect(explainErrorLine(new Error('Unknown capture: cap-1'))).toContain(
      'That item is no longer in the selection — ',
    );
    expect(explainErrorLine(userMessage('Pick an element first'))).toBe('Pick an element first');
  });
});