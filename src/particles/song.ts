import { type DetectedNote, type PipelineEvent, type Source, type TrackSignature } from '../domain';

export const MORPH_SEC = 1.1;
const ROLL_BINS = 480;
const UNKNOWN_ENERGY = 0.35;
const UNKNOWN_BRIGHTNESS = 0.4;
const UNKNOWN_SHARE = 0.5;
const UNKNOWN_BPM = 100;

export type FoundNote = DetectedNote & { foundAt: number };

export function easeInOut(p: number): number {
  const q = Math.min(1, Math.max(0, p));
  return q < 0.5 ? 4 * q * q * q : 1 - (-2 * q + 2) ** 3 / 2;
}

export function sourceSeed(source: Source): number {
  const key = source.kind === 'youtube' ? `youtube:${source.videoId}` : `file:${source.file.name}:${source.file.size}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

function sampleAt(values: Float32Array, u: number): number {
  const x = Math.min(1, Math.max(0, u)) * (values.length - 1);
  const k = Math.floor(x);
  const a = values[k] ?? 0;
  return a + ((values[k + 1] ?? a) - a) * (x - k);
}

export class Song {
  private signature: TrackSignature | null = null;
  private signatureAt = 0;
  private share: Float32Array | null = null;
  private previousShare: Float32Array | null = null;
  private shareAt = 0;
  private readonly found: FoundNote[] = [];
  private readonly bins: FoundNote[][] = Array.from({ length: ROLL_BINS }, () => []);
  throughSec = 0;

  constructor(readonly seed: number, readonly playhead: () => number | null) {}

  apply(event: PipelineEvent, now: number): void {
    switch (event.type) {
      case 'signature':
        this.signature = event.signature;
        this.signatureAt = now;
        return;
      case 'lead':
        this.previousShare = this.share;
        this.share = event.lead.share;
        this.shareAt = now;
        return;
      case 'notesFound':
        for (const note of event.notes) this.place({ ...note, foundAt: now });
        this.throughSec = Math.max(this.throughSec, event.throughSec);
        return;
    }
  }

  get durationSec(): number {
    return this.signature?.durationSec ?? 1;
  }

  private get beatSec(): number {
    return 60 / (this.signature?.bpm ?? UNKNOWN_BPM);
  }

  beatsAt(t: number): number {
    const before = (t * UNKNOWN_BPM) / 60;
    if (!this.signature) return before;
    const gain = 1 / this.beatSec - UNKNOWN_BPM / 60;
    const since = Math.max(0, t - this.signatureAt);
    const ramped = since < MORPH_SEC ? (since * since) / (2 * MORPH_SEC) : since - MORPH_SEC / 2;
    return before + gain * ramped;
  }

  get noteCount(): number {
    return this.found.length;
  }

  shaped(now: number): number {
    return this.signature ? easeInOut((now - this.signatureAt) / MORPH_SEC) : 0;
  }

  energyAt(u: number, now: number): number {
    if (!this.signature) return UNKNOWN_ENERGY;
    return UNKNOWN_ENERGY + (sampleAt(this.signature.energy, u) - UNKNOWN_ENERGY) * this.shaped(now);
  }

  brightnessAt(u: number, now: number): number {
    if (!this.signature) return UNKNOWN_BRIGHTNESS;
    return UNKNOWN_BRIGHTNESS + (sampleAt(this.signature.brightness, u) - UNKNOWN_BRIGHTNESS) * this.shaped(now);
  }

  leadShareAt(u: number, now: number): number {
    if (!this.share) return UNKNOWN_SHARE;
    const from = this.previousShare ? sampleAt(this.previousShare, u) : UNKNOWN_SHARE;
    return from + (sampleAt(this.share, u) - from) * easeInOut((now - this.shareAt) / MORPH_SEC);
  }

  noteAt(u: number, pick: number): FoundNote | null {
    const bin = this.bins[Math.min(ROLL_BINS - 1, Math.floor(u * ROLL_BINS))];
    if (!bin || bin.length === 0) return null;
    return bin[Math.floor(pick * pick * bin.length)] ?? null;
  }

  private place(note: FoundNote): void {
    this.found.push(note);
    const toBin = (sec: number) => Math.min(ROLL_BINS - 1, Math.max(0, Math.floor((sec / this.durationSec) * ROLL_BINS)));
    for (let k = toBin(note.onsetSec); k <= toBin(note.onsetSec + note.durSec); k++) {
      const bin = this.bins[k]!;
      bin.push(note);
      bin.sort((x, y) => y.amplitude - x.amplitude);
    }
  }
}
