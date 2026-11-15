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

describe('message rules', () => {
  it('stays in step with the inspector copy', () => {
    // The published SDK cannot depend on the inspector app, so it carries its
    // own copy. Rewording one without the other is what this guards.
    const inspector = rulesBlock(
      join(__dirname, '../../../inspector-app/src/lib/messages.ts'),
    );
    expect(rulesBlock(join(__dirname, 'messages.ts'))).toBe(inspector);
  });

  it('explains a chip that outlived its capture', () => {
    const explained = explainError(new Error('Unknown capture: cap-1'));
    expect(explained.title).toBe('That item is no longer in the selection');
    expect(explained.action).not.toBe('');
    expect(explained.detail).toBe('Unknown capture: cap-1');
  });

  it('does not blame the screenshot taker for an unknown capture', () => {
    expect(explainError(new Error('Unknown capture: cap-1')).title).not.toBe(
      'The preview picture could not be taken',
    );
  });

  it('keeps unrecognised backend text behind a generic title', () => {
    const explained = explainError(new Error('the disk said no'));
    expect(explained.title).toBe('Something went wrong');
    expect(explained.action).not.toBe('');
    expect(explained.detail).toBe('the disk said no');
  });

  it('renders its own sentences without an invented next step', () => {
    const explained = explainError(userMessage('Keep it under 80 characters'));
    expect(explained.title).toBe('Keep it under 80 characters');
    expect(explained.action).toBe('');
  });

  it('has a one-line form for places without the disclosure', () => {
    expect(explainErrorLine(userMessage('Pick an element first'))).toBe('Pick an element first');
    expect(explainErrorLine(new Error('the disk said no'))).toContain('Something went wrong — ');
  });
});