/**
 * The tab strip.
 *
 * A real ARIA tablist: arrow keys move between tabs, Home and End jump to the
 * ends, and only the selected tab is in the tab order. Panels are hidden with
 * the `hidden` attribute and nothing else, so a panel the code believes is
 * hidden really is -- a class rule that set `display` would outrank the user
 * agent's `[hidden]` rule and paint it anyway.
 */

export function wireTabs(root: ParentNode): void {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.tab-btn'));
  const panels = new Map<string, HTMLElement>();
  for (const button of buttons) {
    const id = button.getAttribute('aria-controls');
    const panel = id ? root.querySelector<HTMLElement>(`#${id}`) : null;
    if (panel) panels.set(button.id, panel);
  }

  const select = (button: HTMLButtonElement, focus = true): void => {
    for (const other of buttons) {
      const selected = other === button;
      other.setAttribute('aria-selected', selected ? 'true' : 'false');
      if (selected) other.removeAttribute('tabindex');
      else other.setAttribute('tabindex', '-1');
      const panel = panels.get(other.id);
      if (panel) panel.hidden = !selected;
    }
    if (focus) button.focus();
  };

  for (const [index, button] of buttons.entries()) {
    button.addEventListener('click', () => select(button, false));
    button.addEventListener('keydown', (event) => {
      const next = {
        ArrowRight: (index + 1) % buttons.length,
        ArrowLeft: (index - 1 + buttons.length) % buttons.length,
        Home: 0,
        End: buttons.length - 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      select(buttons[next]);
    });
  }
}
