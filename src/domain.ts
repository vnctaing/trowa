export type Midi = number & { readonly __brand: 'Midi' };
export const FLUTE_LOW = 60 as Midi;
export const FLUTE_HIGH = 96 as Midi;
export const MAX_TRACK_SECONDS = 8 * 60;
export const TICKS_PER_QUARTER = 4;

export type Source =
  | { kind: 'youtube'; url: string; videoId: string; title: string; author: string; thumbnail: string }
  | { kind: 'file'; file: File; title: string };

export type Options = {
  transpose: number;
  key: 'auto' | number;
  difficulty: 'melody' | 'ornaments';
  tempoOverride: number | null;
};

export type DetectedNote = {
  midi: Midi;
  onsetSec: number;
  durSec: number;
  amplitude: number;
  onset: number;
};

export type QuantizedNote = {
  midi: Midi | null;
  startTick: number;
  durTicks: number;
  ornament?: 'grace' | 'trill';
};

export type Score = {
  title: string;
  source: string;
  bpm: number;
  beatsPerBar: 3 | 4 | 6;
  beatUnit: 4 | 8;
  keyFifths: number;
  notes: QuantizedNote[];
  confidence: number;
};

export type StageId = 'extracting' | 'separating' | 'detecting' | 'notating';
export const STAGES: readonly { id: StageId; label: string }[] = [
  { id: 'extracting', label: 'Extracting audio' },
  { id: 'separating', label: 'Separating melody' },
  { id: 'detecting', label: 'Detecting pitch' },
  { id: 'notating', label: 'Writing notation' },
];

export type ErrorKind =
  | 'invalid_url'
  | 'private'
  | 'region_locked'
  | 'too_long'
  | 'no_melody'
  | 'decode_failed'
  | 'network';

export class TrowaError extends Error {
  constructor(readonly kind: ErrorKind, detail?: string) {
    super(detail ?? kind);
  }
}

export const SIGNATURE_SLICES = 192;

export type TrackSignature = {
  durationSec: number;
  bpm: number;
  energy: Float32Array;
  brightness: Float32Array;
};

export type LeadBalance = { method: 'demucs' | 'filter'; share: Float32Array };

export type PipelineEvent =
  | { type: 'stage'; stage: StageId }
  | { type: 'audio'; buffer: AudioBuffer }
  | { type: 'notes'; notes: DetectedNote[] }
  | { type: 'progress'; stage: StageId; fraction: number }
  | { type: 'signature'; signature: TrackSignature }
  | { type: 'lead'; lead: LeadBalance }
  | { type: 'notesFound'; notes: DetectedNote[]; throughSec: number };

export type AppState =
  | { screen: 'input' }
  | { screen: 'translating'; source: Source; stage: StageId }
  | { screen: 'result'; source: Source; score: Score; musicXml: string }
  | { screen: 'error'; kind: ErrorKind };
