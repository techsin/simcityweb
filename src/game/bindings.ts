/** Profile key bindings. Defaults keep character shortcuts and physical camera positions (FH-19). */
export type KeyBindings = Record<string, string>;

export interface Binding {
  id: string;
  group: string;
  label: string;
  code: string;
  aliases?: readonly string[];
  /** Default tool and panel shortcuts follow the character printed by the keyboard layout. */
  character?: string;
  camera?: boolean;
  modified?: boolean;
  allowShift?: boolean;
}

export const BINDINGS: readonly Binding[] = [
  { id: 'pause', group: 'Simulation', label: 'Pause / resume', code: 'Space', character: ' ', allowShift: true },
  { id: 'speed1', group: 'Simulation', label: 'Normal speed', code: 'Digit1', aliases: ['Numpad1'], allowShift: true },
  { id: 'speed2', group: 'Simulation', label: 'Fast speed', code: 'Digit2', aliases: ['Numpad2'], allowShift: true },
  { id: 'speed3', group: 'Simulation', label: 'Ultra speed', code: 'Digit3', aliases: ['Numpad3'], allowShift: true },
  { id: 'save', group: 'Simulation', label: 'Save city', code: 'KeyS', character: 's', modified: true, allowShift: true },
  { id: 'help', group: 'Simulation', label: 'Help', code: 'F1', allowShift: true },
  { id: 'photo', group: 'Simulation', label: 'Photo mode', code: 'KeyH', character: 'h' },
  { id: 'residential', group: 'Tools', label: 'Residential zone', code: 'KeyR', character: 'r' },
  { id: 'commercial', group: 'Tools', label: 'Commercial zone', code: 'KeyC', character: 'c' },
  { id: 'industrial', group: 'Tools', label: 'Industrial / farms', code: 'KeyI', character: 'i' },
  { id: 'dezone', group: 'Tools', label: 'De-zone', code: 'KeyX', character: 'x' },
  { id: 'roads', group: 'Tools', label: 'Roads', code: 'KeyT', character: 't' },
  { id: 'power', group: 'Tools', label: 'Power line', code: 'KeyL', character: 'l' },
  { id: 'subway', group: 'Tools', label: 'Subway', code: 'KeyU', character: 'u' },
  { id: 'bulldoze', group: 'Tools', label: 'Bulldoze', code: 'KeyB', character: 'b', aliases: ['Delete', 'Backspace'] },
  { id: 'query', group: 'Tools', label: 'Query / inspect', code: 'KeyV', character: 'v' },
  { id: 'terraform', group: 'Tools', label: 'Terraform', code: 'KeyK', character: 'k' },
  { id: 'rotateBuilding', group: 'While building', label: 'Rotate building', code: 'KeyR', character: 'r', allowShift: true },
  { id: 'budget', group: 'Panels', label: 'Budget', code: 'KeyM', character: 'm' },
  { id: 'graphs', group: 'Panels', label: 'Graphs', code: 'KeyG', character: 'g' },
  { id: 'stats', group: 'Panels', label: 'City statistics', code: 'KeyJ', character: 'j' },
  { id: 'advisors', group: 'Panels', label: 'Advisors & news', code: 'KeyN', character: 'n' },
  { id: 'dataviews', group: 'Panels', label: 'Data views', code: 'KeyO', character: 'o' },
  { id: 'ordinances', group: 'Panels', label: 'Ordinances', code: 'KeyY', character: 'y' },
  { id: 'demographics', group: 'Panels', label: 'Demographics', code: 'KeyP', character: 'p' },
  { id: 'panForward', group: 'Camera', label: 'Pan forward', code: 'KeyW', aliases: ['ArrowUp'], camera: true },
  { id: 'panBackward', group: 'Camera', label: 'Pan backward', code: 'KeyS', aliases: ['ArrowDown'], camera: true },
  { id: 'panLeft', group: 'Camera', label: 'Pan left', code: 'KeyA', aliases: ['ArrowLeft'], camera: true },
  { id: 'panRight', group: 'Camera', label: 'Pan right', code: 'KeyD', aliases: ['ArrowRight'], camera: true },
  { id: 'rotateLeft', group: 'Camera', label: 'Rotate camera left', code: 'KeyQ', camera: true },
  { id: 'rotateRight', group: 'Camera', label: 'Rotate camera right', code: 'KeyE', camera: true },
  { id: 'tiltUp', group: 'Camera', label: 'Tilt up', code: 'PageUp', camera: true },
  { id: 'tiltDown', group: 'Camera', label: 'Tilt down', code: 'PageDown', camera: true },
  { id: 'zoomIn', group: 'Camera', label: 'Zoom in', code: 'Equal', aliases: ['NumpadAdd', 'NumpadEqual'], camera: true },
  { id: 'zoomOut', group: 'Camera', label: 'Zoom out', code: 'Minus', aliases: ['NumpadSubtract'], camera: true },
  { id: 'recenter', group: 'Camera', label: 'Recenter', code: 'Home', camera: true },
];

const BY_ID = new Map(BINDINGS.map((b) => [b.id, b]));
const owns = (bindings: KeyBindings | undefined, id: string): boolean => !!bindings && Object.prototype.hasOwnProperty.call(bindings, id);
const codeOf = (b: Binding, bindings?: KeyBindings): string => owns(bindings, b.id) ? bindings![b.id] : b.code;
const codesOf = (b: Binding, bindings?: KeyBindings): readonly string[] => {
  const code = codeOf(b, bindings);
  return code ? [code, ...b.aliases ?? []] : [];
};

/** A missing entry uses the default; an empty string disables the primary key and all its aliases. */
export function matchesBinding(id: string, e: KeyboardEvent, bindings?: KeyBindings): boolean {
  const b = BY_ID.get(id);
  if (!b || !codeOf(b, bindings) || e.altKey) return false;
  if (b.modified ? !e.ctrlKey && !e.metaKey : e.ctrlKey || e.metaKey) return false;
  if (b.id === 'help' && !owns(bindings, id) && e.key === '?') return true;
  if (b.aliases?.some((code) => e.code === code || e.key === code)) return true;
  if (e.shiftKey && !b.allowShift && !b.camera) return false;
  return !owns(bindings, id) && b.character !== undefined
    ? e.key?.toLowerCase() === b.character
    : e.code === codeOf(b, bindings);
}

/** Convert rebound camera positions to the controller's canonical physical codes. */
export function cameraCode(code: string, bindings?: KeyBindings): string | null {
  for (const b of BINDINGS) if (b.camera && codesOf(b, bindings).includes(code)) return b.code;
  return null;
}

export function isCameraCode(code: string, bindings?: KeyBindings): boolean {
  return cameraCode(code, bindings) !== null;
}

export function codeLabel(code: string): string {
  if (!code) return 'Unbound';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return 'Num ' + code.slice(6);
  const labels: Record<string, string> = {
    Space: 'Space', PageUp: 'PgUp', PageDown: 'PgDn', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Equal: '+', Minus: '−', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
    Backquote: '`', Comma: ',', Period: '.', Slash: '/', NumpadAdd: 'Num +', NumpadSubtract: 'Num −',
    NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .', NumpadEqual: 'Num =', NumpadEnter: 'Num Enter',
  };
  return labels[code] ?? code;
}

export function bindingLabel(id: string, bindings?: KeyBindings): string {
  const b = BY_ID.get(id);
  if (!b) return '';
  const code = codeOf(b, bindings);
  return code && b.modified ? 'Ctrl / ⌘ + ' + codeLabel(code) : codeLabel(code);
}

const HELP_IDS: Record<string, readonly string[]> = {
  'Pause / resume': ['pause'], 'Speed normal / fast / ultra': ['speed1', 'speed2', 'speed3'], 'Save city': ['save'],
  Help: ['help'], 'Photo mode': ['photo'], 'Residential zone (repeat: density)': ['residential'], 'Commercial zone': ['commercial'],
  'Industrial / farms': ['industrial'], 'De-zone': ['dezone'], 'Roads (repeat: type)': ['roads'], 'Power line': ['power'],
  Subway: ['subway'], Bulldoze: ['bulldoze'], 'Query / inspect': ['query'], 'Terraform (repeat: mode)': ['terraform'],
  'Rotate building': ['rotateBuilding'], Budget: ['budget'], Graphs: ['graphs'], 'City statistics': ['stats'],
  Demographics: ['demographics'], 'Advisors & news': ['advisors'], 'Data views': ['dataviews'], Ordinances: ['ordinances'],
  Pan: ['panForward', 'panLeft', 'panBackward', 'panRight'], 'Rotate 90°': ['rotateLeft', 'rotateRight'],
  Tilt: ['tiltUp', 'tiltDown'], Recenter: ['recenter'],
};

/** Keep Help's prose and pointer gestures, replacing just the keys that can be rebound. */
export function shortcutKeys(label: string, defaults: string[], bindings?: KeyBindings): string[] {
  const ids = HELP_IDS[label];
  if (ids) {
    if (!ids.some((id) => owns(bindings, id))) return defaults;
    return ids.map((id) => bindingLabel(id, bindings));
  }
  if (label === 'Zoom' && (owns(bindings, 'zoomIn') || owns(bindings, 'zoomOut'))) {
    return [...defaults, bindingLabel('zoomIn', bindings), bindingLabel('zoomOut', bindings)];
  }
  return defaults;
}

export function validBindingCode(code: string): boolean {
  return /^(?:Key[A-Z]|Digit[0-9]|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Equal|Enter)|F(?:[1-9]|1[0-9]|2[0-4])|Arrow(?:Up|Down|Left|Right)|PageUp|PageDown|Home|End|Insert|Delete|Backspace|Enter|Space|Equal|Minus|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Backquote|Comma|Period|Slash|IntlBackslash|IntlRo|IntlYen)$/.test(code);
}

export interface BindingConflict {
  code: string;
  ids: readonly string[];
  message: string;
}

/** Save's Ctrl/Command chord has its own scope; the existing contextual R pair is intentional. */
export function bindingConflicts(bindings: KeyBindings = {}): BindingConflict[] {
  const out: BindingConflict[] = [];
  const used = new Map<string, Binding[]>();
  for (const b of BINDINGS) {
    const code = codeOf(b, bindings);
    if (code && !validBindingCode(code)) {
      out.push({ code, ids: [b.id], message: `${b.label}: ${codeLabel(code)} is reserved or unsupported.` });
      continue;
    }
    for (const c of new Set(codesOf(b, bindings))) {
      const scope = `${b.modified ? 'modified:' : ''}${c}`;
      for (const other of used.get(scope) ?? []) {
        if ([b.id, other.id].sort().join(',') === 'residential,rotateBuilding') continue;
        out.push({ code: c, ids: [other.id, b.id], message: `${codeLabel(c)}: ${other.label} conflicts with ${b.label}.` });
      }
      used.set(scope, [...used.get(scope) ?? [], b]);
    }
  }
  return out;
}
