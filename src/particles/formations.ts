import type { DetectedNote, Midi } from '../domain';
import { stepsAboveBottomLine } from '../ui/music';

export type StaffHead = { midi: Midi; x: number; filled: boolean; stem: boolean };
export type StaffDrawing = {
  heads: readonly StaffHead[];
  keyFifths: number;
  meter: readonly [number, number] | null;
  barlines: boolean;
};

export type Formation =
  | { kind: 'idle' }
  | { kind: 'cloud' }
  | { kind: 'nebula' }
  | { kind: 'streams' }
  | { kind: 'lanes'; notes: readonly DetectedNote[] }
  | { kind: 'staff'; drawing: StaffDrawing };

export type Geometry = { w: number; h: number };

export type Seeds = { a: Float32Array; b: Float32Array; c: Float32Array; d: Float32Array };

export type Sample = {
  i: number;
  t: number;
  since: number;
  band: number;
};

export type Placed = { x: number; y: number; alpha: number };

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

const idle: Spec<{ kind: 'idle' }> = {
  reactivity: 0.2,
  prepare: (_f, { w, h }) => (s, { a, b, c, d }, out) => {
    const ra = pick(a, s.i), rb = pick(b, s.i), rc = pick(c, s.i), rd = pick(d, s.i);
    out.x = frac(ra + s.t * 0.004 * (rc - 0.5)) * w * 1.1 - w * 0.05 + Math.sin(s.t * 0.13 + rd * TAU) * 24;
    out.y = frac(rb + s.t * 0.006 * (rd - 0.4)) * h * 1.1 - h * 0.05 + Math.cos(s.t * 0.11 + rc * TAU) * 24;
    out.alpha = 0.04 + 0.16 * rc * rc;
  },
};

const cloud: Spec<{ kind: 'cloud' }> = {
  reactivity: 1,
  prepare: (_f, { w, h }) => {
    const r = Math.min(w, h) * 0.36;
    return (s, { a, b, c, d }, out) => {
      const ra = pick(a, s.i), rb = pick(b, s.i), rc = pick(c, s.i), rd = pick(d, s.i);
      const angle = ra * TAU + s.t * 0.18 * (rc - 0.5) + Math.sin(s.t * 0.4 + rd * 9) * 0.3;
      const rad = r * Math.sqrt(rb) * (0.75 + 0.55 * s.band) + Math.sin(s.t * 1.3 + rd * 20) * r * 0.06;
      out.x = w / 2 + Math.cos(angle) * rad * 1.35;
      out.y = h / 2 + Math.sin(angle) * rad * 0.95;
      out.alpha = 0.16 + 0.55 * s.band * (0.3 + rc);
    };
  },
};

const nebula: Spec<{ kind: 'nebula' }> = {
  reactivity: 0.55,
  prepare: (_f, { w, h }) => {
    const r = Math.min(w * 0.42, h * 0.62);
    return (s, { a, b, c, d }, out) => {
      const ra = pick(a, s.i), rb = pick(b, s.i), rc = pick(c, s.i), rd = pick(d, s.i);
      const norm = rb ** 0.75;
      const arm = Math.floor(rd * 3);
      const angle = (arm * TAU) / 3 + norm * 3.4 + s.t * (0.32 - norm * 0.18) + (ra - 0.5) * (0.9 - norm * 0.4);
      const rad = r * (0.04 + 0.96 * norm);
      out.x = w / 2 + Math.cos(angle) * rad;
      out.y = h / 2 + Math.sin(angle) * rad * 0.5;
      out.alpha = (0.25 + 0.6 * (1 - norm)) * (0.5 + rc * 0.5) + 0.3 * s.band;
    };
  },
};

const streams: Spec<{ kind: 'streams' }> = {
  reactivity: 0.35,
  prepare: (_f, { w, h }) => (s, { a, b, c, d }, out) => {
    const ra = pick(a, s.i), rb = pick(b, s.i), rc = pick(c, s.i), rd = pick(d, s.i);
    const melody = rc < 0.45;
    const u = frac(ra + s.t * (melody ? 0.035 : 0.028));
    const lane = melody ? -1 : 1;
    const spread = melody ? 0.035 : 0.075;
    const drift = melody ? 0 : Math.min(1, s.since / 2.4) * h * 0.08;
    out.x = -w * 0.05 + u * w * 1.1;
    out.y =
      h / 2 + lane * h * 0.1 + lane * drift +
      Math.sin(u * 7 + s.t * 0.7 + (melody ? 0 : 2.1)) * h * 0.07 +
      (rb - 0.5) * h * spread;
    const fade = melody ? 1 : Math.max(0.06, 1 - s.since / 2.4);
    out.alpha = (melody ? 0.6 + 0.35 * rd : 0.35 * rd + 0.1) * fade;
  },
};

const lanes: Spec<{ kind: 'lanes'; notes: readonly DetectedNote[] }> = {
  reactivity: 0.18,
  prepare: ({ notes }, { w, h }) => {
    const LANES = 13;
    const top = h * 0.24;
    const span = h * 0.52;
    const midis = notes.map((n) => n.midi as number);
    const lo = midis.length ? Math.min(...midis) : 0;
    const hi = midis.length ? Math.max(...midis) : 1;
    const laneY = (midi: number) => top + span * (1 - (midi - lo) / Math.max(1, hi - lo));
    const total = notes.reduce((m, n) => Math.max(m, n.onsetSec + n.durSec), 0) + 1;
    const pxPerSec = Math.max(w / 9, 60);
    return (s, { a, b, c, d }, out) => {
      const ra = pick(a, s.i), rb = pick(b, s.i), rc = pick(c, s.i), rd = pick(d, s.i);
      const onNote = notes.length > 0 && rc < 0.72;
      if (onNote) {
        const n = notes[Math.floor(ra * notes.length)]!;
        const at = (n.onsetSec + rd * n.durSec * 0.92 - s.t * 0.8) % total;
        const wrapped = at < 0 ? at + total : at;
        out.x = w * 0.08 + wrapped * pxPerSec;
        out.y = laneY(n.midi) + (rb - 0.5) * 3;
        out.alpha = 0.55 + 0.4 * rb;
        return;
      }
      const lane = Math.floor(rb * LANES);
      out.x = frac(ra + s.t * 0.02) * w;
      out.y = top + (span * lane) / (LANES - 1) + (rd - 0.5) * 1.5;
      out.alpha = 0.08 + 0.1 * rd;
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
        return;
      }
      const k = Math.floor(pick(a, s.i) * count);
      out.x = (points[k * 2] ?? 0) + (pick(b, s.i) - 0.5) * 1.6;
      out.y = (points[k * 2 + 1] ?? 0) + (pick(c, s.i) - 0.5) * 1.6;
      out.alpha = (onLine ? 0.3 : 0.45) + 0.3 * pick(b, s.i);
    };
  },
};

type Placer = (s: Sample, seeds: Seeds, out: Placed) => void;

export function prepare(f: Formation, g: Geometry): { place: Placer; reactivity: number } {
  switch (f.kind) {
    case 'idle':
      return { place: idle.prepare(f, g), reactivity: idle.reactivity };
    case 'cloud':
      return { place: cloud.prepare(f, g), reactivity: cloud.reactivity };
    case 'nebula':
      return { place: nebula.prepare(f, g), reactivity: nebula.reactivity };
    case 'streams':
      return { place: streams.prepare(f, g), reactivity: streams.reactivity };
    case 'lanes':
      return { place: lanes.prepare(f, g), reactivity: lanes.reactivity };
    case 'staff':
      return { place: staff.prepare(f, g), reactivity: staff.reactivity };
  }
}
