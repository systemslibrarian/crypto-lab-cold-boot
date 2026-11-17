/**
 * Small DOM helpers. No framework; the exhibits are plain elements so the
 * accessibility gate is reading what the code actually builds.
 */

type Attrs = Record<string, string | number | boolean | null | undefined>;

/** Create an element with attributes and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** Replace an element's children. */
export function fill(target: Element, children: (Node | string | null | undefined)[]): void {
  target.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined));
}

/**
 * A horizontally scrollable region. Needs tabindex, a role and a label, or a
 * keyboard-only reader cannot reach what it holds (and the Linux CI runner
 * fails it even where local Chromium passes).
 */
export function scrollRegion(label: string, child: Node, className = 'table-scroll'): HTMLElement {
  return el('div', { class: className, tabindex: '0', role: 'region', 'aria-label': label }, [child]);
}

/** A definition-list readout of label/value pairs. */
export function readout(pairs: [string, Node | string][]): HTMLElement {
  const list = el('dl', { class: 'readout' });
  for (const [label, value] of pairs) {
    list.append(el('dt', { text: label }));
    list.append(el('dd', {}, [typeof value === 'string' ? document.createTextNode(value) : value]));
  }
  return list;
}

/** A labelled statistic. */
export function stat(label: string, value: string): HTMLElement {
  return el('li', {}, [el('span', { class: 'stat-label', text: label }), el('span', { class: 'stat-value', text: value })]);
}

/** A strip of statistics. */
export function statStrip(stats: [string, string][]): HTMLElement {
  return el(
    'ul',
    { class: 'stat-strip', role: 'list' },
    stats.map(([label, value]) => {
      const item = stat(label, value);
      item.setAttribute('role', 'listitem');
      return item;
    }),
  );
}

/** A pass/fail/neutral line: mark, then words. Never colour alone. */
export function checkLine(kind: 'pass' | 'fail' | 'note', text: string): HTMLElement {
  const mark = kind === 'pass' ? 'OK' : kind === 'fail' ? 'XX' : '--';
  return el('p', { class: `check-line check-${kind}` }, [
    el('span', { class: 'check-mark', 'aria-hidden': 'true', text: mark }),
    el('span', { text: `${kind === 'pass' ? 'Pass: ' : kind === 'fail' ? 'Fail: ' : 'Note: '}${text}` }),
  ]);
}

/** A labelled control wrapping a native input. */
export function control(
  id: string,
  label: string,
  node: HTMLElement,
  hint?: string,
): HTMLElement {
  node.id = id;
  const wrap = el('div', { class: 'control' }, [el('label', { for: id, text: label }), node]);
  if (hint) wrap.append(el('span', { class: 'control-hint', text: hint }));
  return wrap;
}

/** Percentage with one decimal, as a string. */
export function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** Milliseconds, rendered at a sensible precision with its unit. */
export function ms(value: number): string {
  if (value < 1) return `${value.toFixed(3)} ms`;
  if (value < 100) return `${value.toFixed(2)} ms`;
  if (value < 10_000) return `${value.toFixed(0)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

/** Thousands separators for a count. */
export function count(value: number): string {
  return value.toLocaleString('en-US');
}
