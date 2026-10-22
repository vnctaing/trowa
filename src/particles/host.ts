import { ParticleField } from './field';

const DESKTOP_COUNT = 4000;
const NARROW_COUNT = 1200;

function particleCount(): number {
  const override = Number(new URLSearchParams(location.search).get('particles'));
  if (override > 0) return override;
  return window.innerWidth < 700 ? NARROW_COUNT : DESKTOP_COUNT;
}

export class FieldHost {
  private field: ParticleField | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly reducedMotion: boolean) {}

  acquire(): ParticleField {
    if (this.field) return this.field;
    this.canvas.style.transition = '';
    this.canvas.style.opacity = '1';
    this.field = new ParticleField(this.canvas, { reducedMotion: this.reducedMotion, count: particleCount() });
    return this.field;
  }

  async release(fadeMs: number): Promise<void> {
    const field = this.field;
    if (!field) return;
    this.field = null;
    await field.dissolve(fadeMs);
    if (!this.field) field.destroy();
  }
}
