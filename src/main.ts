/**
 * Cold Boot -- a browser demo of cold-boot key recovery.
 *
 * Follows J. A. Halderman, S. D. Schoen, N. Heninger, W. Clarkson, W. Paul,
 * J. A. Calandrino, A. J. Feldman, J. Appelbaum and E. W. Felten, "Lest We
 * Remember: Cold Boot Attacks on Encryption Keys", 17th USENIX Security
 * Symposium, 2008, sections 5.1 and 5.2; and FIPS 197 for the key expansion.
 *
 * Everything computes. There is no canned verdict anywhere in this lab: the
 * key expansion is real AES-128, the decay is drawn from
 * crypto.getRandomValues, and the recovery is a real search over the image the
 * page is holding.
 */

import './style.css';
import { renderDecayPanel } from './ui/decay-panel';
import { renderDefendsPanel } from './ui/defends-panel';
import { renderNaivePanel } from './ui/naive-panel';
import { renderRecoverPanel } from './ui/recover-panel';
import { renderSchedulePanel } from './ui/schedule-panel';
import { SearchWorker } from './ui/search-worker';
import { renderSlicePanel } from './ui/slice-panel';
import { Store } from './ui/state';
import { renderTrialsPanel } from './ui/trials-panel';
import { wireTabs } from './ui/tabs';

function panel(id: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`#panel-${id}`);
  if (!node) throw new Error(`missing panel: ${id}`);
  return node;
}

const store = new Store(0.15, 0);
const worker = new SearchWorker();

renderSchedulePanel(panel('schedule'), store);
renderDecayPanel(panel('decay'), store);
renderNaivePanel(panel('naive'), store);
renderSlicePanel(panel('slice'), store);
renderRecoverPanel(panel('recover'), store, worker);
renderTrialsPanel(panel('trials'), store, worker);
renderDefendsPanel(panel('defends'));

wireTabs(document);
