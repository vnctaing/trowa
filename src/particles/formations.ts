import type { Midi } from '../domain';
import { stepsAboveBottomLine } from '../ui/music';
import { BANDS } from './audio';
import { easeInOut, type Song } from './song';

export type StaffHead = { midi: Midi; x: number; filled: boolean; stem: boolean };
export type StaffDrawing = {
  heads: readonly StaffHead[];
  keyFifths: number;
  meter: readonly [number, number] | null;
  barlines: boolean;
};

export type Formation =
  | { kind: 'idle' }
  | { kind: 'nebula'; song: Song }
  | { kind: 'streams'; song: Song }
  | { kind: 'roll'; song: Song }
  | { kind: 'staff'; drawing: StaffDrawing };

export type Geometry = { w: number; h: number };

export type Seeds = { a: Float32Array; b: Float32Array; c: Float32Array; d: Float32Array };

export type Sample = {
  i: number;
  t: number;
  now: number;
  since: number;
  calm: boolean;
  bands: Float32Array;
};

export type Placed = { x: number; y: number; alpha: number; glow: number };

type Spec<F extends Formation> = {
  reactivity: number;
  prepare: (f: F, g: Geometry) => (s: Sample, seeds: Seeds, out: Placed) => void;
};

const TAU = Math.PI * 2;

function frac(v: number): number {
  return v - Math.floor(v);
}

function pick(arr: Float32Array, i: number): number {
  return arr[i] ?? 0;
}

function morphClock(s: Sample): number {
  return s.calm ? Infinity : s.now;
}

function bandAt(bands: Float32Array, u: number): number {
  return bands[Math.min(BANDS - 1, Math.max(0, Math.floor(u * BANDS)))] ?? 0;
}

const idle: Spec<{ kind: 'idle' }> = {
  reactivity: 0.2,
  prepare: (_f, { w, h }) => (s, { a, b, c, d }, out) => {
    const ra = pick(a, s.i), rb = pick(b, s.i), rc = pick(c, s.i), rd = pick(d, s.i);
    out.x = frac(ra + s.t * 0.004 * (rc - 0.5)) * w * 1.1 - w * 0.05 + Math.sin(s.t * 0.13 + rd * TAU) * 24;
    out.y = frac(rb + s.t * 0.006 * (rd - 0.4)) * h * 1.1 - h * 0.05 + Math.cos(s.t * 0.11 + rc * TAU) * 24;
    out.alpha = 0.04 + 0.16 * rc * rc;
    out.glow = bandAt(s.bands, rd);
  },
};

const nebula: Spec<{ kind: 'nebula'; song: Song }> = {
  reactivity: 0.5,
  prepare: ({ song }, { w, h }) => {
    const r = Math.min(w * 0.42, h * 0.62);
    const arms = 2 + (song.seed % 3);
    return (s, { a, b, c, d }, out) => {
      const ra = pick(a, s.i), rb = pick(b, s.i), rc = pick(c, s.i), rd = pick(d, s.i);
      const u = rb ** 0.8;
      const now = morphClock(s);
      const energy = song.energyAt(u, now);
      const twist = 2.2 + 3.2 * song.brightnessAt(u, now);
      const band = bandAt(s.bands, u);
      const beats = song.beatsAt(s.t);
      const swell = 0.5 - 0.5 * Math.cos((TAU * beats) / 2);
      const spin = (TAU * beats) / 32;
      const arm = Math.floor(rd * arms);
      const angle = (arm * TAU) / arms + u * twist + spin + (ra - 0.5) * (0.2 + 1.1 * energy) * (1 - 0.5 * u);
      const rad = r * (0.04 + 0.96 * u) * (1 + 0.03 * swell + 0.1 * band);
      out.x = w / 2 + Math.cos(angle) * rad;
      out.y = h / 2 + Math.sin(angle) * rad * 0.5;
      out.alpha = (0.1 + 0.8 * energy) * (0.45 + 0.55 * rc) + 0.25 * band;
      out.glow = band;
    };
  },
};

const STREAM_FADE_SEC = 2.6;
const STREAM_WIDTHS_PER_BEAT = 0.0108;

const streams: Spec<{ kind: 'streams'; song: Song }> = {
  reactivity: 0.4,
  prepare: ({ song }, { w, h }) => {
    const mid = h * 0.46;
    return (s, { a, b, c, d }, out) => {
      const ra = pick(a, s.i), rb = pick(b, s.i), rc = pick(c, s.i), rd = pick(d, s.i);
      const lead = rc < 0.5;
      const u = frac(ra + song.beatsAt(s.t) * STREAM_WIDTHS_PER_BEAT * (lead ? 1 : 0.85));
      const now = morphClock(s);
      const energy = song.energyAt(u, now);
      const share = song.leadShareAt(u, now);
      const amount = energy * (lead ? share : 1 - share);
      const parting = easeInOut(s.since / STREAM_FADE_SEC);
      const band = lead ? bandAt(s.bands, 0.4 + 0.3 * rd) : bandAt(s.bands, 0.35 * rd);
      const thickness = h * (0.006 + 0.1 * amount) * (1 + 0.3 * band);
      const centre = lead ? mid - h * 0.08 - energy * h * 0.1 : mid + h * 0.08 + parting * h * 0.07;
      const wave = Math.sin(u * TAU * 2 + s.t * 0.6 + (lead ? 0 : 1.9)) * h * 0.025;
      out.x = -w * 0.04 + u * w * 1.08;
      out.y = centre + wave + (rb - 0.5) * 2 * thickness;
      out.alpha = (0.1 + 0.85 * amount) * (0.55 + 0.45 * rd) * (lead ? 1 : 1 - 0.92 * parting);
      out.glow = band;
    };
  },
};

const ROLL_LOW = 36;
const ROLL_HIGH = 96;
const GUIDE_SHARE = 0.16;
const REVEAL_SEC = 0.9;
const CATCH_UP_SEC = 1.4;

const roll: Spec<{ kind: 'roll'; song: Song }> = {
  reactivity: 0.22,
  prepare: ({ song }, { w, h }) => {
    const left = w * 0.06;
    const width = w * 0.88;
    const top = h * 0.2;
    const bottom = h * 0.7;
    const pitchU = (midi: number) => Math.min(1, Math.max(0, (midi - ROLL_LOW) / (ROLL_HIGH - ROLL_LOW)));
    const laneY = (midi: number) => bottom - pitchU(midi) * (bottom - top);
    const octaves = (ROLL_HIGH - ROLL_LOW) / 12 + 1;
    return (s, { a, b, c, d }, out) => {
      const shownAt = s.now - s.since;
      const ra = pick(a, s.i), rb = pick(b, s.i), rc = pick(c, s.i), rd = pick(d, s.i);
      const duration = song.durationSec;
      const front = Math.min(1, song.throughSec / duration);
      const frontX = left + front * width;
      if (rd < GUIDE_SHARE) {
        const x = left + frac(ra + s.t * 0.006) * width;
        out.x = x;
        out.y = laneY(ROLL_LOW + 12 * Math.floor(rb * octaves));
        out.alpha = x < frontX ? 0.12 : 0.05;
        out.glow = 0;
        return;
      }
      const u = ra;
      const note = song.noteAt(u, rb);
      const waitX = frontX + Math.max(0, u - front) * (left + width - frontX) * 0.1 + Math.sin(s.t * 0.8 + rc * 20) * 5;
      const waitY = top + rc * (bottom - top);
      if (!note) {
        const passed = u < front;
        out.x = passed ? left + u * width : waitX;
        out.y = passed ? bottom + h * 0.03 + (rc - 0.5) * 3 : waitY;
        out.alpha = s.calm ? 0 : passed ? 0.04 : 0.07;
        out.glow = 0;
        return;
      }
      const sec = Math.min(note.onsetSec + note.durSec, Math.max(note.onsetSec, u * duration));
      const noteX = left + (sec / duration) * width;
      const noteY = laneY(note.midi) + (rd - 0.5) * 2.4;
      const p = s.calm ? 1 : easeInOut((s.now - Math.max(note.foundAt, shownAt + (sec / duration) * CATCH_UP_SEC)) / REVEAL_SEC);
      const playhead = song.playhead();
      const hearing = playhead === null ? 0 : Math.exp(-(((playhead - sec) / 0.35) ** 2));
      const band = bandAt(s.bands, pitchU(note.midi));
      out.x = waitX + (noteX - waitX) * p;
      out.y = waitY + (noteY - waitY) * p;
      out.alpha = 0.07 * (1 - p) + p * (0.16 + 0.34 * Math.min(1, note.amplitude * 1.6) + 0.6 * hearing);
      out.glow = Math.max(band, hearing);
    };
  },
};

export function staffMetrics({ w, h }: Geometry) {
  const gap = Math.max(9, Math.min(h * 0.045, w * 0.05, 26));
  const left = Math.max(16, w * (w < 700 ? 0.05 : 0.1));
  const right = w - left;
  const bottom = h / 2 + gap * 2;
  return { gap, left, right, bottom, lineY: (k: number) => bottom - k * gap };
}

const SHARP_STEPS = [8, 5, 9, 6, 3, 7, 4];
const FLAT_STEPS = [4, 7, 3, 6, 2, 5, 1];

type Layer = 'lines' | 'glyphs';

function drawStaff(ctx: CanvasRenderingContext2D, d: StaffDrawing, g: Geometry, scale: number, layer: Layer): void {
  const { gap, left, right, bottom, lineY } = staffMetrics(g);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = Math.max(1, gap * 0.07);
  ctx.globalAlpha = layer === 'lines' ? 1 : 0;
  for (let k = 0; k < 5; k++) {
    ctx.beginPath();
    ctx.moveTo(left, lineY(k));
    ctx.lineTo(right, lineY(k));
    ctx.stroke();
  }
  ctx.globalAlpha = layer === 'glyphs' ? 1 : 0;
  let x = left + gap * 0.6;
  if (d.meter) {
    ctx.font = `${gap * 6.2}px "Apple Symbols", "Noto Music", "Segoe UI Symbol", serif`;
    ctx.textBaseline = 'alphabetic';
    const clef = '\u{1D11E}';
    if (ctx.measureText(clef).width > gap) {
      ctx.fillText(clef, x, bottom + gap * 1.15);
      x += gap * 3;
    }
    const steps = d.keyFifths >= 0 ? SHARP_STEPS : FLAT_STEPS;
    ctx.font = `${gap * 2.6}px "Apple Symbols", serif`;
    for (let k = 0; k < Math.abs(d.keyFifths); k++) {
      ctx.fillText(d.keyFifths >= 0 ? '♯' : '♭', x, bottom - (steps[k] ?? 0) * gap * 0.5 + gap * 0.85);
      x += gap * 1.05;
    }
    ctx.font = `600 ${gap * 2.3}px "Cormorant Garamond", serif`;
    ctx.textAlign = 'center';
    ctx.fillText(String(d.meter[0]), x + gap, lineY(2) - gap * 0.08);
    ctx.fillText(String(d.meter[1]), x + gap, lineY(0) - gap * 0.08);
    ctx.textAlign = 'start';
    x += gap * 2.6;
  }
  if (d.barlines) {
    ctx.lineWidth = Math.max(1.2, gap * 0.12);
    ctx.beginPath();
    ctx.moveTo(right, lineY(4));
    ctx.lineTo(right, lineY(0));
    ctx.stroke();
  }
  const startX = x + gap;
  const width = right - gap * 1.5 - startX;
  for (const head of d.heads) {
    const step = stepsAboveBottomLine(head.midi, d.keyFifths);
    const hx = startX + head.x * width;
    const hy = bottom - step * gap * 0.5;
    ctx.lineWidth = Math.max(1, gap * 0.1);
    for (let ledger = -2; ledger >= step; ledger -= 2) {
      ctx.beginPath();
      ctx.moveTo(hx - gap * 0.95, bottom - ledger * gap * 0.5);
      ctx.lineTo(hx + gap * 0.95, bottom - ledger * gap * 0.5);
      ctx.stroke();
    }
    for (let ledger = 10; ledger <= step; ledger += 2) {
      ctx.beginPath();
      ctx.moveTo(hx - gap * 0.95, bottom - ledger * gap * 0.5);
      ctx.lineTo(hx + gap * 0.95, bottom - ledger * gap * 0.5);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(-0.35);
    ctx.beginPath();
    ctx.ellipse(0, 0, gap * 0.66, gap * 0.45, 0, 0, TAU);
    if (head.filled) ctx.fill();
    else {
      ctx.lineWidth = gap * 0.16;
      ctx.stroke();
    }
    ctx.restore();
    if (head.stem) {
      const up = step < 4;
      ctx.lineWidth = Math.max(1, gap * 0.11);
      ctx.beginPath();
      const sx = up ? hx + gap * 0.58 : hx - gap * 0.58;
      ctx.moveTo(sx, hy);
      ctx.lineTo(sx, up ? hy - gap * 3.4 : hy + gap * 3.4);
      ctx.stroke();
    }
  }
  ctx.restore();
}

const RASTER_SCALE = 0.5;

function rasterize(d: StaffDrawing, g: Geometry, layer: Layer): Float32Array {
  const cw = Math.max(1, Math.ceil(g.w * RASTER_SCALE));
  const ch = Math.max(1, Math.ceil(g.h * RASTER_SCALE));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return new Float32Array();
  drawStaff(ctx, d, g, RASTER_SCALE, layer);
  const { data } = ctx.getImageData(0, 0, cw, ch);
  const points: number[] = [];
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if ((data[(y * cw + x) * 4 + 3] ?? 0) > 110) points.push(x / RASTER_SCALE, y / RASTER_SCALE);
    }
  }
  return Float32Array.from(points);
}

const LINE_SHARE = 0.38;

const staff: Spec<{ kind: 'staff'; drawing: StaffDrawing }> = {
  reactivity: 0.06,
  prepare: ({ drawing }, g) => {
    const lines = rasterize(drawing, g, 'lines');
    const glyphs = rasterize(drawing, g, 'glyphs');
    return (s, { a, b, c, d }, out) => {
      const onLine = glyphs.length === 0 || pick(d, s.i) < LINE_SHARE;
      const points = onLine ? lines : glyphs;
      const count = points.length / 2;
      if (count === 0) {
        out.x = g.w / 2;
        out.y = g.h / 2;
        out.alpha = 0;
        out.glow = 0;
        return;
      }
      const k = Math.floor(pick(a, s.i) * count);
      out.x = (points[k * 2] ?? 0) + (pick(b, s.i) - 0.5) * 1.6;
      out.y = (points[k * 2 + 1] ?? 0) + (pick(c, s.i) - 0.5) * 1.6;
      out.alpha = (onLine ? 0.3 : 0.45) + 0.3 * pick(b, s.i);
      out.glow = bandAt(s.bands, pick(c, s.i));
    };
  },
};

type Placer = (s: Sample, seeds: Seeds, out: Placed) => void;

export function prepare(f: Formation, g: Geometry): { place: Placer; reactivity: number } {
  switch (f.kind) {
    case 'idle':
      return { place: idle.prepare(f, g), reactivity: idle.reactivity };
    case 'nebula':
      return { place: nebula.prepare(f, g), reactivity: nebula.reactivity };
    case 'streams':
      return { place: streams.prepare(f, g), reactivity: streams.reactivity };
    case 'roll':
      return { place: roll.prepare(f, g), reactivity: roll.reactivity };
    case 'staff':
      return { place: staff.prepare(f, g), reactivity: staff.reactivity };
  }
}
