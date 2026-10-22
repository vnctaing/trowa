import { BANDS, type Spectrum, type TrackListener } from './audio';
import { prepare, type Formation, type Geometry, type Placed, type Sample, type Seeds } from './formations';

const BACKGROUND = '#0B0D12';
const SPRITE_COLORS = ['#4F5E82', '#9AA9CB', '#EFE6D2', '#E8B44A'] as const;
const SPRITE_PX = 32;
const STAGGER_MS = 260;

export type FieldConfig = { reducedMotion: boolean; count: number };

function easeInOutCubic(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
}

function makeSprite(color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE_PX;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(SPRITE_PX / 2, SPRITE_PX / 2, 0, SPRITE_PX / 2, SPRITE_PX / 2, SPRITE_PX / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.18, color);
  g.addColorStop(0.45, `${color}55`);
  g.addColorStop(1, `${color}00`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  return c;
}

function randoms(n: number): Float32Array {
  const arr = new Float32Array(n);
  for (let i = 0; i < n; i++) arr[i] = Math.random();
  return arr;
}

export class ParticleField {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites = SPRITE_COLORS.map(makeSprite);
  private readonly seeds: Seeds;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly a: Float32Array;
  private readonly fromX: Float32Array;
  private readonly fromY: Float32Array;
  private readonly fromA: Float32Array;
  private readonly placed: Placed = { x: 0, y: 0, alpha: 0 };
  private readonly sample: Sample = { i: 0, t: 0, since: 0, energy: 0, band: 0 };
  private readonly idleSpectrum: Spectrum = { level: 0, bands: new Float32Array(BANDS) };
  private readonly observer: ResizeObserver;
  private geometry: Geometry = { w: 1, h: 1 };
  private formation: Formation = { kind: 'idle' };
  private current = prepare(this.formation, this.geometry);
  private changedAt = performance.now();
  private durationMs = 1;
  private listener: TrackListener | null = null;
  private frame = 0;
  private frames = 0;
  private fpsWindowStart = performance.now();
  fps = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly config: FieldConfig) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx;
    const n = config.count;
    this.seeds = { a: randoms(n), b: randoms(n), c: randoms(n), d: randoms(n) };
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.a = new Float32Array(n);
    this.fromX = new Float32Array(n);
    this.fromY = new Float32Array(n);
    this.fromA = new Float32Array(n);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    this.settleAt(this.formation);
    this.frame = requestAnimationFrame(this.tick);
  }

  get count(): number {
    return this.config.count;
  }

  listen(listener: TrackListener | null): void {
    this.listener = listener;
  }

  setFormation(formation: Formation, durationMs = 1100): void {
    this.fromX.set(this.x);
    this.fromY.set(this.y);
    this.fromA.set(this.a);
    this.formation = formation;
    this.current = prepare(formation, this.geometry);
    this.changedAt = performance.now();
    this.durationMs = durationMs;
  }

  dissolve(ms: number): Promise<void> {
    this.canvas.style.transition = `opacity ${ms}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    this.canvas.style.opacity = '0';
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
  }

  private settleAt(formation: Formation): void {
    this.current = prepare(formation, this.geometry);
    this.changedAt = performance.now() - 10_000;
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.geometry = { w: rect.width, h: rect.height };
    this.current = prepare(this.formation, this.geometry);
    this.ctx.fillStyle = BACKGROUND;
    this.ctx.fillRect(0, 0, rect.width, rect.height);
  }

  private spectrum(now: number): Spectrum {
    if (this.listener) return this.listener.read();
    const s = this.idleSpectrum;
    const t = now / 1000;
    s.level = 0.12 + 0.05 * Math.sin(t * 0.9);
    for (let b = 0; b < BANDS; b++) s.bands[b] = 0.1 + 0.08 * Math.sin(t * (0.7 + b * 0.23) + b);
    return s;
  }

  private readonly tick = (now: number): void => {
    this.frame = requestAnimationFrame(this.tick);
    this.frames++;
    if (now - this.fpsWindowStart >= 1000) {
      this.fps = (this.frames * 1000) / (now - this.fpsWindowStart);
      this.canvas.dataset.fps = this.fps.toFixed(1);
      this.frames = 0;
      this.fpsWindowStart = now;
    }
    this.draw(now);
  };

  private draw(now: number): void {
    const { ctx, config, seeds } = this;
    const { w, h } = this.geometry;
    const reduced = config.reducedMotion;
    const spectrum = this.spectrum(now);
    const elapsed = now - this.changedAt;
    const t = reduced ? this.changedAt / 1000 : now / 1000;

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = reduced ? 1 : 0.34;
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    const sample = this.sample;
    const out = this.placed;
    const reactivity = reduced ? 0 : this.current.reactivity;
    sample.t = t;
    sample.since = reduced ? 60 : elapsed / 1000;
    sample.energy = spectrum.level;
    const span = this.durationMs + (reduced ? 0 : STAGGER_MS);

    for (let i = 0; i < config.count; i++) {
      const band = spectrum.bands[i % BANDS] ?? 0;
      sample.i = i;
      sample.band = band;
      this.current.place(sample, seeds, out);
      const seedA = seeds.a[i] ?? 0;
      const seedD = seeds.d[i] ?? 0;
      const delay = reduced ? 0 : (seeds.c[i] ?? 0) * STAGGER_MS;
      const p = elapsed >= span ? 1 : Math.min(1, Math.max(0, (elapsed - delay) / this.durationMs));
      const e = easeInOutCubic(p);
      const fx = this.fromX[i] ?? 0;
      const fy = this.fromY[i] ?? 0;
      const fa = this.fromA[i] ?? 0;

      let x: number;
      let y: number;
      let alpha: number;
      if (reduced) {
        x = out.x;
        y = out.y;
        alpha = out.alpha * e;
        if (e < 1) this.drawParticle(fx, fy, fa * (1 - e), band, seedD, 0);
      } else {
        const jitter = (2 + 30 * band) * reactivity;
        x = fx + (out.x - fx) * e + (Math.sin(t * 1.7 + seedA * 40) + Math.cos(t * 1.1 + seedD * 30)) * jitter;
        y = fy + (out.y - fy) * e + (Math.cos(t * 1.4 + seedA * 25) + Math.sin(t * 0.9 + seedD * 50)) * jitter;
        alpha = fa + (out.alpha - fa) * e;
      }
      this.x[i] = x;
      this.y[i] = y;
      this.a[i] = alpha;
      this.drawParticle(x, y, alpha, band, seedD, reactivity);
    }
    ctx.globalAlpha = 1;
  }

  private drawParticle(x: number, y: number, alpha: number, band: number, seed: number, reactivity: number): void {
    if (alpha < 0.01) return;
    const lum = Math.min(1, alpha * (0.6 + band * 0.9));
    const bucket = lum < 0.32 ? 0 : lum < 0.62 ? 1 : lum > 0.8 && seed > 0.7 ? 3 : 2;
    const size = (1.6 + 2.4 * seed) * (1 + band * 0.7 * reactivity) * 3;
    this.ctx.globalAlpha = Math.min(1, alpha);
    this.ctx.drawImage(this.sprites[bucket]!, x - size / 2, y - size / 2, size, size);
  }
}
