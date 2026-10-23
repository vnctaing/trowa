import { TrowaError, type DetectedNote, type ErrorKind, type TrackSignature } from '../domain';
import type { Detection, FoundNotes } from './pitch';
import type { MonoPcm } from './wav';

export type AnalysisRequest =
  | { op: 'load'; modelUrl: string }
  | { op: 'hold'; samples: Float32Array; sampleRate: number }
  | { op: 'emphasize' }
  | { op: 'demucs'; endpoint: string }
  | { op: 'detect' };

export type AnalysisReply = {
  load: string;
  hold: TrackSignature;
  emphasize: Float32Array;
  demucs: Float32Array | null;
  detect: Detection;
};

export type AnalysisMessage =
  | { id: number; kind: 'done'; value: AnalysisReply[AnalysisRequest['op']] }
  | { id: number; kind: 'failed'; message: string; errorKind: ErrorKind | null }
  | { id: number; kind: 'progress'; fraction: number }
  | { id: number; kind: 'found'; notes: DetectedNote[]; throughSec: number };

type Pending = {
  resolve: (value: never) => void;
  reject: (err: unknown) => void;
  onProgress?: (fraction: number) => void;
  onFound?: FoundNotes;
};

export class Analysis {
  private readonly worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;

  constructor(signal?: AbortSignal) {
    this.worker.onmessage = ({ data }: MessageEvent<AnalysisMessage>) => this.receive(data);
    this.worker.onerror = (e) => this.fail(new Error(`analysis worker: ${e.message}`));
    signal?.addEventListener('abort', () => this.fail(new DOMException('The pipeline was aborted.', 'AbortError')));
  }

  load(modelUrl: string): Promise<string> {
    return this.call({ op: 'load', modelUrl });
  }

  hold(mix: MonoPcm): Promise<TrackSignature> {
    return this.call({ op: 'hold', samples: mix.samples, sampleRate: mix.sampleRate }, [mix.samples.buffer as ArrayBuffer]);
  }

  emphasize(): Promise<Float32Array> {
    return this.call({ op: 'emphasize' });
  }

  demucs(endpoint: string): Promise<Float32Array | null> {
    return this.call({ op: 'demucs', endpoint });
  }

  detect(onProgress: (fraction: number) => void, onFound: FoundNotes): Promise<Detection> {
    return this.call({ op: 'detect' }, [], { onProgress, onFound });
  }

  close(): void {
    this.worker.terminate();
  }

  private call<R extends AnalysisRequest>(
    request: R,
    transfer: Transferable[] = [],
    listeners: Pick<Pending, 'onProgress' | 'onFound'> = {},
  ): Promise<AnalysisReply[R['op']]> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: never) => void, reject, ...listeners });
      this.worker.postMessage({ id, ...request }, transfer);
    });
  }

  private receive(message: AnalysisMessage): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    switch (message.kind) {
      case 'progress':
        pending.onProgress?.(message.fraction);
        return;
      case 'found':
        pending.onFound?.(message.notes, message.throughSec);
        return;
      case 'done':
        this.pending.delete(message.id);
        pending.resolve(message.value as never);
        return;
      case 'failed':
        this.pending.delete(message.id);
        pending.reject(message.errorKind ? new TrowaError(message.errorKind, message.message) : new Error(message.message));
        return;
    }
  }

  private fail(err: unknown): void {
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(err);
    this.pending.clear();
  }
}
