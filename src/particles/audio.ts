export const BANDS = 8;

export type Spectrum = { bands: Float32Array };

export class TrackListener {
  private readonly analyser: AnalyserNode;
  private readonly gain: GainNode;
  private readonly bins: Uint8Array<ArrayBuffer>;
  private readonly spectrum: Spectrum = { bands: new Float32Array(BANDS) };
  private source: AudioBufferSourceNode | null = null;

  constructor(private readonly ctx: AudioContext, private readonly volume: number) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.82;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.analyser.connect(this.gain).connect(ctx.destination);
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
  }

  play(buffer: AudioBuffer): void {
    this.stop(0);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.analyser);
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(this.volume, now + 2);
    source.start();
    this.source = source;
    void this.ctx.resume();
  }

  stop(fadeSec: number): void {
    const source = this.source;
    if (!source) return;
    this.source = null;
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0, now + fadeSec);
    source.stop(now + fadeSec + 0.05);
  }

  read(): Spectrum {
    if (!this.source) {
      this.spectrum.bands.forEach((v, i) => (this.spectrum.bands[i] = v * 0.95));
      return this.spectrum;
    }
    this.analyser.getByteFrequencyData(this.bins);
    const usable = Math.floor(this.bins.length * 0.7);
    for (let b = 0; b < BANDS; b++) {
      const from = Math.round(usable ** (b / BANDS));
      const to = Math.max(from + 1, Math.round(usable ** ((b + 1) / BANDS)));
      let sum = 0;
      for (let k = from; k < to; k++) sum += this.bins[k] ?? 0;
      const v = sum / (to - from) / 255;
      const prev = this.spectrum.bands[b] ?? 0;
      this.spectrum.bands[b] = prev + (v - prev) * (v > prev ? 0.5 : 0.12);
    }
    return this.spectrum;
  }
}
