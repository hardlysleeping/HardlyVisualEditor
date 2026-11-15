/**
 * The inspector overlay: it loads, the context panel carries the edit surfaces,
 * Settings saves only the four values the plugin reads, destructive actions ask
 * in the app's own dialog, and a refusal is explained instead of dumped as raw
 * text.
 *
 * The overlay opens with its toolbar only; the panel is what holds the edit
 * controls, so every check here opens it first.
 */

import { sampleElement, stubSource } from '../lib/stub.mjs';

const ELEMENT = sampleElement();

const TRANSACTIONS = [
  {
    id: 'txn-1',
    label: 'Set padding',
    operations: [
      {
        operation: 'set_style',
        identity: {
          webview_id: 'main',
          inspector_id: null,
          html_id: 'card',
          semantic_selector: '#card',
          generated_id: null,
        },
        property: 'padding',
        before: '0px',
        after: '16px',
      },
    ],
  },
];

/**
 * Loads the overlay and opens the context panel, which holds the edit surfaces.
 * A selection opens it by itself, so the toggle is only used when it is shut.
 */
async function open(page, origin) {
  await page.goto(`${origin}/index.html`);
  await page.getByRole('navigation', { name: 'Visual Inspector' }).waitFor({ state: 'visible', timeout: 15000 });
  const notes = page.getByText('Publish and drafts');
  if ((await notes.count()) === 0) {
    await page.getByRole('button', { name: 'Context panel' }).click();
  }
  await notes.first().waitFor({ state: 'visible', timeout: 15000 });
}

export async function run({ context, origin, check }) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.addInitScript(stubSource({ elements: [ELEMENT], transactions: TRANSACTIONS }));

  await open(page, origin);

  /* 1. It loads, asks for state once, and nothing threw. */
  check('window loads without a script error', errors.length === 0, errors[0]);
  const stateCalls = await page.evaluate(() => window.__TEST__.callsTo('plugin:visual-editor|get_state').length);
  check('startup reads the hub state', stateCalls === 1, `${stateCalls} calls`);

  /* 2. The edit surfaces are on screen. */
  const panels = [
    { name: 'Structure', locator: page.getByText(/^Structure · \d+ sections$/) },
    { name: 'Edit versions', locator: page.getByText(/^Edit versions \(\d+\)$/) },
    { name: 'Publish and drafts', locator: page.getByText('Publish and drafts') },
    { name: 'Pictures', locator: page.getByText('Pictures', { exact: true }) },
  ];
  const missing = [];
  for (const panel of panels) {
    if ((await panel.locator.count()) === 0) missing.push(panel.name);
  }
  check('main panels are rendered', missing.length === 0, missing.join(', '));

  /* 3. Settings saves exactly what the plugin reads, and says so. */
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Editor settings' });
  const opened = (await settings.count()) === 1;
  check('Settings opens a dialog', opened);
  if (opened) {
    check('Settings dialog is visible', await settings.isVisible());
    await page.evaluate(() => window.__TEST__.resetCalls());
    await settings.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(400);
    const update = await page.evaluate(() => window.__TEST__.callsTo('plugin:visual-editor|update_settings'));
    const keys = update.length === 1 ? Object.keys(update[0].args.patch ?? update[0].args).sort() : [];
    check(
      'Settings writes the four live fields',
      JSON.stringify(keys) ===
        JSON.stringify(['crop_padding', 'overlay_color', 'screenshot_absolute_path', 'screenshot_dir']),
      JSON.stringify(keys),
    );
    const saved = await page.getByText('Settings saved', { exact: true }).count();
    check('Settings reports the save', saved >= 1);
  }

  /* 4. Reset edits asks in the app's own dialog, and cancelling keeps the edits. */
  await page.getByRole('button', { name: 'Reset edits', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: /Reset all HardlyUI edits/ });
  const confirmShown = (await confirm.count()) === 1;
  check('Reset edits opens the in-app dialog', confirmShown);
  if (confirmShown) {
    await page.evaluate(() => window.__TEST__.resetCalls());
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(300);
    const resets = await page.evaluate(() => window.__TEST__.callsTo('plugin:visual-editor|reset_edits').length);
    const stillOpen = await page.getByRole('dialog', { name: /Reset all HardlyUI edits/ }).count();
    check('Cancel closes it without resetting', resets === 0 && stillOpen === 0, `${resets} reset calls`);
  }

  /* 5. A backend refusal is explained, with the original text kept. */
  const failing = await context.newPage();
  await failing.addInitScript(
    stubSource({
      elements: [ELEMENT],
      transactions: TRANSACTIONS,
      fail: { 'plugin:visual-editor|reset_edits': 'Unknown capture: cap-1' },
    }),
  );
  await open(failing, origin);
  await failing.getByRole('button', { name: 'Reset edits', exact: true }).click();
  await failing
    .getByRole('dialog', { name: /Reset all HardlyUI edits/ })
    .getByRole('button', { name: 'Reset every edit', exact: true })
    .click();
  await failing.waitForTimeout(500);
  const alert = failing.getByRole('alert').first();
  const alertText = (await alert.count()) === 1 ? await alert.innerText() : '';
  const alertDetail = (await alert.count()) === 1 ? await alert.textContent() : '';
  check(
    'a refused reset is explained in plain words',
    alertText.includes('That item is no longer in the selection'),
    alertText.slice(0, 160),
  );
  check('the original text stays available', (alertDetail ?? '').includes('Unknown capture: cap-1'), 'no Details text');
  await failing.close();
  await page.close();
}
