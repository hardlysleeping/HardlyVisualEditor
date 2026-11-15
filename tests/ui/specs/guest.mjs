/**
 * The guest toolbar, injected into a plain host page: it mounts, the picker
 * arms, a click selects, and closing removes the toolbar again.
 */

import { stubSource } from '../lib/stub.mjs';

export async function run({ context, origin, check }) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.addInitScript(stubSource());
  await page.goto(`${origin}/host.html`);
  await page.waitForTimeout(300);

  const hasRuntime = await page.evaluate(() => typeof window.__VISUAL_EDITOR_GUEST__?.openToolbar === 'function');
  check('guest runtime loads in a host page', hasRuntime);

  if (hasRuntime) {
    await page.evaluate(() => window.__VISUAL_EDITOR_GUEST__.openToolbar('main'));
    await page.waitForTimeout(400);
    const mounted = await page.evaluate(() => Boolean(document.getElementById('visual-editor-toolbar-root')));
    check('toolbar mounts', mounted);
    check('no script error while mounting', errors.length === 0, errors[0]);

    if (mounted) {
      const buttons = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#visual-editor-toolbar-root button')).map((button) =>
          button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '',
        ),
      );
      const expected = ['Element picker', 'Context panel', 'Hard reload'];
      const missing = expected.filter((label) => !buttons.some((name) => name.includes(label)));
      check('toolbar carries its actions', missing.length === 0, missing.join(', '));

      /* The hub reports the editor as on, so the picker arms itself. */
      const armed = await page.evaluate(
        () => document.querySelector('[data-visual-editor-picker-toggle]')?.dataset.active ?? '',
      );
      check('the picker is armed when the hub says the editor is on', armed === 'true', `active=${armed}`);

      await page.click('#copy');
      await page.waitForTimeout(500);
      const picked = await page.evaluate(
        () => window.__TEST__.callsTo('plugin:visual-editor|report_selection').length,
      );
      check('picking an element reports the selection', picked >= 1, `${picked} calls`);

      /* Turning the picker off stops selection. */
      await page.getByRole('button', { name: /Element picker/ }).first().click();
      await page.waitForTimeout(300);
      const disabledCalls = await page.evaluate(
        () => window.__TEST__.callsTo('plugin:visual-editor|disable').length,
      );
      check('turning the picker off tells the plugin', disabledCalls === 1, `${disabledCalls} calls`);

      /* closeToolbar hides the toolbar and keeps it mounted for the next open. */
      await page.evaluate(() => window.__VISUAL_EDITOR_GUEST__.closeToolbar());
      await page.waitForTimeout(300);
      const hidden = await page.evaluate(
        () => document.getElementById('visual-editor-toolbar-root')?.style.display ?? 'missing',
      );
      check('closing hides the toolbar', hidden === 'none', hidden);

      await page.evaluate(() => window.__VISUAL_EDITOR_GUEST__.openToolbar());
      await page.waitForTimeout(300);
      const shown = await page.evaluate(
        () => document.getElementById('visual-editor-toolbar-root')?.style.display ?? 'missing',
      );
      check('opening it again shows the same toolbar', shown !== 'none' && shown !== 'missing', shown);
    }
  }

  await page.close();
}
