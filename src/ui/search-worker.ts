/**
 * The page's side of the worker: one worker, shared by exhibits 5 and 6, with
 * request ids so a reply from an abandoned run is ignored rather than
 * rendered.
 */

import type { RecoverRequest, TrialsRequest, WorkerReply, WorkerRequest } from '../cold/trials';

/** A request minus the id this class assigns. */
type Sendable = Omit<RecoverRequest, 'id'> | Omit<TrialsRequest, 'id'>;

export type ReplyHandler = (reply: WorkerReply) => void;

export class SearchWorker {
  private worker: Worker | null = null;
  private nextId = 1;
  private handlers = new Set<ReplyHandler>();

  /** Lazily started, so a visitor who never runs a search never spawns one. */
  private ensure(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('../cold/worker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
      for (const handler of this.handlers) handler(event.data);
    });
    return this.worker;
  }

  on(handler: ReplyHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Send a request and return the id it will reply under. */
  send(request: Sendable): number {
    const id = this.nextId++;
    this.ensure().postMessage({ ...request, id } as WorkerRequest);
    return id;
  }

  cancel(): void {
    this.worker?.postMessage({ kind: 'cancel' } satisfies WorkerRequest);
  }

  /**
   * Stop the current search immediately by discarding the worker. `cancel`
   * alone only takes effect at the search's next check, which on a
   * pathological image can be a while; dropping the worker is instant and the
   * next request starts a fresh one.
   */
  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
