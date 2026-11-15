#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const PLUGIN_VERSION = '0.2.1';
const HISTORY_SEED = `${JSON.stringify({ transactions: [], cursor: 0 }, null, 2)}\n`;
const OVERRIDES_SEED = '/* HardlyUI visual edits. Generated file; edit through HardlyUI. */\n';

function fail(message) {
  console.error(`hardlyui: ${message}`);
  process.exitCode = 1;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function findTauriConfig(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'src-tauri', 'tauri.conf.json'),
    path.join(projectRoot, 'src-tauri', 'tauri.windows.conf.json'),
    path.join(projectRoot, 'tauri.conf.json'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function ensureCargoDependency(cargoFile) {
  if (!fs.existsSync(cargoFile)) return 'No src-tauri/Cargo.toml found';
  let content = fs.readFileSync(cargoFile, 'utf8');
  const dependency = `tauri-plugin-visual-editor = { version = "${PLUGIN_VERSION}", features = ["visual-inspector"] }`;
  const existing = content.match(/^(tauri-plugin-visual-editor\s*=\s*)(.+)$/m);
  if (existing) {
    if (existing[2].includes('visual-inspector')) return 'Rust plugin dependency already has visual-inspector enabled';
    let value = existing[2].trim();
    if (value.startsWith('{') && value.endsWith('}')) {
      if (/\bfeatures\s*=\s*\[[^\]]*\]/.test(value)) {
        value = value.replace(/(\bfeatures\s*=\s*\[)([^\]]*)(\])/, (_all, start, features, end) =>
          `${start}${features.trim() ? `${features.trim()}, ` : ''}"visual-inspector"${end}`,
        );
      } else {
        value = value.replace(/}\s*$/, ', features = ["visual-inspector"] }');
      }
    } else {
      const scalar = value.replace(/^(["'])(.*)\1$/, '$2');
      value = `{ version = "${scalar}", features = ["visual-inspector"] }`;
    }
    content = content.replace(existing[0], `${existing[1]}${value}`);
    fs.writeFileSync(cargoFile, content);
    return 'Enabled visual-inspector on the existing Rust plugin dependency';
  }
  const dependenciesHeader = /^\[dependencies\]\s*$/m;
  if (dependenciesHeader.test(content)) {
    content = content.replace(dependenciesHeader, (header) => `${header}\n${dependency}`);
  } else {
    content = `${content.trimEnd()}\n\n[dependencies]\n${dependency}\n`;
  }
  fs.writeFileSync(cargoFile, content);
  return 'Added the Rust plugin dependency';
}

function ensureRustPluginInit(tauriRoot) {
  const candidates = [
    path.join(tauriRoot, 'src', 'lib.rs'),
    path.join(tauriRoot, 'src', 'main.rs'),
  ];
  const sourcePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!sourcePath) return 'No src-tauri/src/lib.rs or main.rs found';
  let content = fs.readFileSync(sourcePath, 'utf8');
  if (content.includes('tauri_plugin_visual_editor::init()')) return 'Rust plugin registration already exists';
  const runCall = /(\n[ \t]*)\.run\s*\(/m;
  if (!runCall.test(content)) return 'Could not find a Tauri .run(...) call; register the plugin manually';
  content = content.replace(runCall, (_match, indent) =>
    `${indent}.plugin(tauri_plugin_visual_editor::init())${indent}.run(`,
  );
  fs.writeFileSync(sourcePath, content);
  return `Registered the plugin in ${path.relative(tauriRoot, sourcePath)}`;
}

function ensureCapability(tauriRoot) {
  const capabilitiesDir = path.join(tauriRoot, 'capabilities');
  fs.mkdirSync(capabilitiesDir, { recursive: true });
  const preferred = path.join(capabilitiesDir, 'default.json');
  const existing = fs.existsSync(preferred)
    ? preferred
    : fs.readdirSync(capabilitiesDir).filter((file) => file.endsWith('.json')).sort()
      .map((file) => path.join(capabilitiesDir, file))[0];
  const capabilityPath = existing ?? preferred;
  let capability = existing
    ? JSON.parse(fs.readFileSync(existing, 'utf8'))
    : {
        $schema: '../gen/schemas/desktop-schema.json',
        identifier: 'default',
        description: 'HardlyUI development editing capability',
        windows: ['main'],
        permissions: ['core:default'],
      };
  const permissions = new Set(capability.permissions ?? []);
  for (const permission of ['visual-editor:default', 'visual-editor:inspect', 'visual-editor:editing']) {
    permissions.add(permission);
  }
  capability.permissions = [...permissions];
  const windows = new Set(capability.windows ?? ['main']);
  windows.add('visual-inspector');
  capability.windows = [...windows];
  writeJson(capabilityPath, capability);
  return `Enabled visual editor permissions in ${path.relative(tauriRoot, capabilityPath)}`;
}

function ensureFrontendImport(projectRoot) {
  const candidates = [
    'src/main.tsx', 'src/main.ts', 'src/main.jsx', 'src/main.js',
    'src/app.ts', 'src/app.js',
  ].map((file) => path.join(projectRoot, file));
  const entry = candidates.find((candidate) => fs.existsSync(candidate));
  if (!entry) return 'No common frontend entry point found; import hardlyui-overrides.css manually';
  const cssFile = path.join(projectRoot, 'hardlyui-overrides.css');
  let source = fs.readFileSync(entry, 'utf8');
  if (source.includes('hardlyui-overrides.css')) return 'Override stylesheet import already exists';
  let relative = path.relative(path.dirname(entry), cssFile).split(path.sep).join('/');
  if (!relative.startsWith('.')) relative = `./${relative}`;
  const importLine = `import '${relative}';`;
  source = source.startsWith('#!')
    ? source.replace(/^(#![^\n]*\n)/, `$1${importLine}\n`)
    : `${importLine}\n${source}`;
  fs.writeFileSync(entry, source);
  return `Imported overrides from ${path.relative(projectRoot, entry)}`;
}

function init(projectArg) {
  const projectRoot = path.resolve(projectArg ?? process.cwd());
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    fail(`project directory does not exist: ${projectRoot}`);
    return;
  }
  const configPath = findTauriConfig(projectRoot);
  if (!configPath) {
    fail(`no Tauri JSON config found under ${projectRoot}`);
    return;
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    fail(`cannot parse ${path.relative(projectRoot, configPath)} as JSON (${error.message}); JSON5 configs need manual setup`);
    return;
  }

  const tauriRoot = path.dirname(configPath);
  const relativeRoot = path.relative(tauriRoot, projectRoot).split(path.sep).join('/') || '.';
  config.plugins ??= {};
  config.plugins.visualEditor = {
    ...(config.plugins.visualEditor ?? {}),
    enabled: true,
    allow: true,
    allowInProduction: false,
    projectRoot: relativeRoot,
  };
  writeJson(configPath, config);

  const hardlyuiDir = path.join(projectRoot, '.hardlyui');
  fs.mkdirSync(hardlyuiDir, { recursive: true });
  const historyPath = path.join(hardlyuiDir, 'history.json');
  if (!fs.existsSync(historyPath)) fs.writeFileSync(historyPath, HISTORY_SEED);
  const overridesPath = path.join(projectRoot, 'hardlyui-overrides.css');
  if (!fs.existsSync(overridesPath)) fs.writeFileSync(overridesPath, OVERRIDES_SEED);

  const results = [
    `Configured ${path.relative(projectRoot, configPath)} with projectRoot "${relativeRoot}"`,
    ensureCargoDependency(path.join(tauriRoot, 'Cargo.toml')),
    ensureRustPluginInit(tauriRoot),
    ensureCapability(tauriRoot),
    ensureFrontendImport(projectRoot),
    `Created ${path.relative(projectRoot, historyPath)} and ${path.relative(projectRoot, overridesPath)} when missing`,
  ];
  console.log('HardlyUI initialized.');
  for (const result of results) console.log(`- ${result}`);
  console.log('\nRun your normal Tauri dev command. Editing remains development-only unless allowInProduction is changed.');
}

const [command, ...args] = process.argv.slice(2);
if (command === 'init') {
  init(args.find((value) => !value.startsWith('-')));
} else if (command === '--help' || command === '-h' || !command) {
  console.log('Usage: hardlyui init [project-directory]');
  console.log('Finds a Tauri JSON config and wires project-root persistence, permissions, and the overrides stylesheet.');
} else {
  fail(`unknown command "${command}"; run hardlyui --help`);
}
