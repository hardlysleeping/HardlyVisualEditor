/** Optional insert catalogs. Adapters emit plain DOM edits and never add host dependencies. */

export type InsertPresetNode = {
  tag: 'div' | 'p' | 'span' | 'button';
  text: string;
  classNames: string[];
  styles: Array<[string, string]>;
  children?: InsertPresetNode[];
};

export type InsertPreset = InsertPresetNode & {
  id: string;
  label: string;
};

export type InsertCatalogContext = {
  classNames: string[];
  cssVariables: Array<[string, string]>;
  dataAttributes: string[];
};

type CatalogAdapter = (context: InsertCatalogContext) => InsertPreset[];

function themeToken(context: InsertCatalogContext, names: string[]): string | null {
  const available = new Set(context.cssVariables.map(([name]) => name.toLowerCase()));
  const name = names.find((candidate) => available.has(candidate));
  return name ? `var(${name})` : null;
}

const builtInCatalog: CatalogAdapter = (context) => [
  { id: 'text', label: 'Text', tag: 'p', text: 'New text', classNames: [], styles: [] },
  {
    id: 'button', label: 'Button', tag: 'button', text: 'New button', classNames: [],
    styles: [
      ['padding', '8px 14px'],
      ['background-color', themeToken(context, ['--color-primary', '--primary', '--color-accent', '--accent', '--brand-primary']) ?? '#238636'],
      ['color', themeToken(context, ['--color-primary-content', '--primary-foreground', '--on-primary', '--color-base-content']) ?? '#ffffff'],
      ['border-radius', themeToken(context, ['--radius-field', '--radius', '--button-radius']) ?? '6px'],
      ['font-weight', '600'],
    ],
  },
  { id: 'container', label: 'Container', tag: 'div', text: 'New container', classNames: [], styles: [] },
  {
    id: 'card', label: 'Card', tag: 'div', text: 'New card', classNames: [],
    styles: [
      ['padding', '16px'],
      ['background-color', themeToken(context, ['--color-base-100', '--card', '--surface', '--background']) ?? '#161b22'],
      ['color', themeToken(context, ['--color-base-content', '--card-foreground', '--foreground']) ?? '#e6edf3'],
      ['border-radius', themeToken(context, ['--radius-box', '--radius', '--card-radius']) ?? '10px'],
    ],
  },
  {
    id: 'badge', label: 'Badge', tag: 'span', text: 'Badge', classNames: [],
    styles: [
      ['padding', '3px 8px'],
      ['background-color', themeToken(context, ['--color-accent', '--accent', '--color-primary', '--primary']) ?? '#1f6feb'],
      ['color', themeToken(context, ['--color-accent-content', '--accent-foreground', '--color-base-content']) ?? '#ffffff'],
      ['border-radius', '999px'],
      ['font-size', '12px'],
    ],
  },
  {
    id: 'content-card', label: 'Content card', tag: 'div', text: '', classNames: [],
    styles: [
      ['display', 'flex'], ['flex-direction', 'column'], ['gap', '8px'], ['padding', '16px'],
      ['background-color', themeToken(context, ['--color-base-100', '--card', '--surface', '--background']) ?? '#161b22'],
      ['color', themeToken(context, ['--color-base-content', '--card-foreground', '--foreground']) ?? '#e6edf3'],
      ['border-radius', themeToken(context, ['--radius-box', '--radius', '--card-radius']) ?? '10px'],
    ],
    children: [
      { tag: 'p', text: 'Section title', classNames: [], styles: [['margin', '0px'], ['font-weight', '600']] },
      { tag: 'p', text: 'Add a short description here.', classNames: [], styles: [['margin', '0px']] },
      {
        tag: 'button', text: 'Get started', classNames: [],
        styles: [
          ['padding', '8px 14px'],
          ['background-color', themeToken(context, ['--color-primary', '--primary', '--color-accent', '--accent', '--brand-primary']) ?? '#238636'],
          ['color', themeToken(context, ['--color-primary-content', '--primary-foreground', '--on-primary', '--color-base-content']) ?? '#ffffff'],
          ['border-radius', themeToken(context, ['--radius-field', '--radius', '--button-radius']) ?? '6px'],
          ['font-weight', '600'],
        ],
      },
    ],
  },
  {
    id: 'action-row', label: 'Action row', tag: 'div', text: '', classNames: [],
    styles: [
      ['display', 'flex'], ['flex-wrap', 'wrap'], ['align-items', 'center'], ['gap', '8px'], ['padding', '8px'],
    ],
    children: [
      { tag: 'p', text: 'Ready to start?', classNames: [], styles: [['margin', '0px']] },
      {
        tag: 'button', text: 'Continue', classNames: [],
        styles: [
          ['padding', '8px 14px'],
          ['background-color', themeToken(context, ['--color-primary', '--primary', '--color-accent', '--accent', '--brand-primary']) ?? '#238636'],
          ['color', themeToken(context, ['--color-primary-content', '--primary-foreground', '--on-primary', '--color-base-content']) ?? '#ffffff'],
          ['border-radius', themeToken(context, ['--radius-field', '--radius', '--button-radius']) ?? '6px'],
        ],
      },
    ],
  },
  {
    id: 'playback-minimal', label: 'Playback · minimal bar', tag: 'div', text: '', classNames: [],
    styles: [
      ['display', 'flex'], ['align-items', 'center'], ['gap', '12px'], ['padding', '10px 14px'],
      ['border-radius', '10px'], ['background-color', themeToken(context, ['--color-base-200', '--surface', '--background']) ?? '#202630'],
      ['color', themeToken(context, ['--color-base-content', '--foreground']) ?? '#f0f3f6'],
    ],
    children: [
      { tag: 'button', text: '▶', classNames: [], styles: [['width', '36px'], ['height', '36px'], ['border-radius', '999px']] },
      { tag: 'div', text: 'Track title · Artist', classNames: [], styles: [['flex', '1'], ['min-width', '0'], ['font-weight', '600']] },
      { tag: 'button', text: '♡', classNames: [], styles: [['padding', '6px']] },
    ],
  },
  {
    id: 'playback-two-row', label: 'Playback · two-row', tag: 'div', text: '', classNames: [],
    styles: [
      ['display', 'flex'], ['flex-direction', 'column'], ['gap', '8px'], ['padding', '12px 16px'],
      ['border-radius', '12px'], ['background-color', themeToken(context, ['--color-base-200', '--surface', '--background']) ?? '#202630'],
      ['color', themeToken(context, ['--color-base-content', '--foreground']) ?? '#f0f3f6'],
    ],
    children: [
      { tag: 'div', text: 'Track title · Artist', classNames: [], styles: [['font-weight', '600']] },
      { tag: 'div', text: '◀◀     ▶     ▶▶', classNames: [], styles: [['display', 'flex'], ['justify-content', 'center'], ['gap', '16px']] },
      { tag: 'div', text: '0:42  ━━━━━━━━━  3:18', classNames: [], styles: [['font-size', '12px'], ['opacity', '0.75']] },
    ],
  },
  {
    id: 'playback-cover-led', label: 'Playback · cover-led', tag: 'div', text: '', classNames: [],
    styles: [
      ['display', 'flex'], ['align-items', 'center'], ['gap', '14px'], ['padding', '14px'],
      ['border-radius', '12px'], ['background-color', themeToken(context, ['--color-base-200', '--surface', '--background']) ?? '#202630'],
      ['color', themeToken(context, ['--color-base-content', '--foreground']) ?? '#f0f3f6'],
    ],
    children: [
      { tag: 'div', text: '♪', classNames: [], styles: [['width', '56px'], ['height', '56px'], ['display', 'flex'], ['align-items', 'center'], ['justify-content', 'center'], ['border-radius', '8px'], ['background-color', '#343d49'], ['font-size', '24px']] },
      { tag: 'div', text: 'Track title · Artist', classNames: [], styles: [['flex', '1'], ['font-weight', '600']] },
      { tag: 'button', text: '▶', classNames: [], styles: [['width', '40px'], ['height', '40px'], ['border-radius', '999px']] },
    ],
  },
];

const daisyUiCatalog: CatalogAdapter = ({ classNames }) => {
  const markers = new Set([
    'btn-primary', 'btn-secondary', 'btn-accent', 'btn-ghost', 'btn-outline',
    'badge-primary', 'badge-secondary', 'badge-accent', 'badge-outline',
    'card-body', 'bg-base-100',
  ]);
  if (!classNames.some((name) => markers.has(name))) return [];
  return [
    {
      id: 'daisyui-button', label: 'DaisyUI Button', tag: 'button', text: 'New button',
      classNames: ['btn', 'btn-primary'], styles: [],
    },
    {
      id: 'daisyui-card', label: 'DaisyUI Card', tag: 'div', text: 'New card',
      classNames: ['card', 'bg-base-100', 'shadow-xl'], styles: [],
    },
    {
      id: 'daisyui-badge', label: 'DaisyUI Badge', tag: 'span', text: 'Badge',
      classNames: ['badge', 'badge-primary'], styles: [],
    },
  ];
};

const flowbiteCatalog: CatalogAdapter = ({ dataAttributes }) => {
  const markers = new Set([
    'data-dropdown-toggle', 'data-modal-target', 'data-tooltip-target',
    'data-accordion', 'data-tabs-toggle', 'data-collapse-toggle',
    'data-drawer-target', 'data-popover-target',
  ]);
  if (!dataAttributes.some((name) => markers.has(name))) return [];
  return [
    {
      id: 'flowbite-button', label: 'Flowbite Button', tag: 'button', text: 'New button',
      classNames: [
        'text-white', 'bg-blue-700', 'hover:bg-blue-800', 'focus:ring-4',
        'focus:ring-blue-300', 'font-medium', 'rounded-lg', 'text-sm', 'px-5', 'py-2.5',
      ], styles: [],
    },
    {
      id: 'flowbite-card', label: 'Flowbite Card', tag: 'div', text: 'New card',
      classNames: [
        'p-6', 'bg-white', 'border', 'border-gray-200', 'rounded-lg', 'shadow-sm',
      ], styles: [],
    },
    {
      id: 'flowbite-badge', label: 'Flowbite Badge', tag: 'span', text: 'Badge',
      classNames: [
        'text-xs', 'font-medium', 'px-2.5', 'py-0.5', 'rounded',
        'bg-blue-100', 'text-blue-800',
      ], styles: [],
    },
  ];
};

const tailwindCatalog: CatalogAdapter = ({ classNames }) => {
  const utilityPattern = /^(?:[!@a-z0-9_-]+:)*(?:flex|grid|inline-flex|block|hidden|bg-|text-|p-|px-|py-|pt-|pr-|pb-|pl-|m-|mx-|my-|rounded|border|shadow|gap-|items-|justify-)/i;
  if (!classNames.some((name) => utilityPattern.test(name))) return [];
  return [
    {
      id: 'tailwind-button', label: 'Tailwind Button', tag: 'button', text: 'New button',
      classNames: [
        'inline-flex', 'items-center', 'justify-center', 'rounded-md', 'bg-blue-600',
        'px-4', 'py-2', 'text-sm', 'font-semibold', 'text-white', 'shadow-sm',
      ], styles: [
        ['display', 'inline-flex'], ['align-items', 'center'], ['justify-content', 'center'],
        ['padding', '8px 16px'], ['border-radius', '6px'], ['background-color', '#2563eb'],
        ['color', '#ffffff'], ['font-size', '14px'], ['font-weight', '600'],
        ['box-shadow', '0 1px 2px rgb(0 0 0 / 0.05)'],
      ],
    },
    {
      id: 'tailwind-card', label: 'Tailwind Card', tag: 'div', text: 'New card',
      classNames: [
        'rounded-xl', 'border', 'border-gray-200', 'bg-white', 'p-4', 'text-gray-900',
        'shadow-sm',
      ], styles: [
        ['padding', '16px'], ['border', '1px solid #e5e7eb'], ['border-radius', '12px'],
        ['background-color', '#ffffff'], ['color', '#111827'],
        ['box-shadow', '0 1px 2px rgb(0 0 0 / 0.05)'],
      ],
    },
    {
      id: 'tailwind-badge', label: 'Tailwind Badge', tag: 'span', text: 'Badge',
      classNames: [
        'inline-flex', 'items-center', 'rounded-full', 'bg-blue-100', 'px-2.5', 'py-0.5',
        'text-xs', 'font-medium', 'text-blue-800',
      ], styles: [
        ['display', 'inline-flex'], ['align-items', 'center'], ['padding', '2px 10px'],
        ['border-radius', '9999px'], ['background-color', '#dbeafe'], ['color', '#1e40af'],
        ['font-size', '12px'], ['font-weight', '500'],
      ],
    },
  ];
};

const catalogAdapters: CatalogAdapter[] = [builtInCatalog, daisyUiCatalog, flowbiteCatalog, tailwindCatalog];

/** Resolve built-in and detected optional framework catalogs for this host. */
export function availableInsertPresets(context: InsertCatalogContext): InsertPreset[] {
  return catalogAdapters.flatMap((adapter) => adapter(context));
}
