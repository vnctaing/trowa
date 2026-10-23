import { OpenSheetMusicDisplay, VexFlowGraphicalNote } from 'opensheetmusicdisplay';
import { TICKS_PER_QUARTER } from '../domain';

const TICKS_PER_WHOLE = TICKS_PER_QUARTER * 4;
const PLAYING_CLASS = 'is-playing';

export class ScoreSheet {
  private readonly osmd: OpenSheetMusicDisplay;
  private stepTicks: number[] = [];
  private step = -1;
  private lit: SVGGElement[] = [];
  private noteTicks = new Map<Element, number>();

  constructor(private readonly container: HTMLElement) {
    this.osmd = new OpenSheetMusicDisplay(container, {
      backend: 'svg',
      autoResize: true,
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawPartNames: false,
      drawCredits: false,
      followCursor: true,
      cursorsOptions: [{ type: 0, color: '#8A7F6A', alpha: 0.16, follow: true }],
    });
  }

  async render(musicXml: string): Promise<void> {
    await this.osmd.load(musicXml);
    this.osmd.zoom = Math.min(1, Math.max(0.55, this.container.clientWidth / 860));
    this.osmd.render();
    this.noteTicks = new Map();
    this.stepTicks = this.collectSteps();
    this.step = -1;
    this.lit = [];
  }

  private collectSteps(): number[] {
    const cursor = this.osmd.cursor;
    if (!cursor) return [];
    const ticks: number[] = [];
    cursor.reset();
    while (!cursor.Iterator.EndReached) {
      const tick = cursor.Iterator.currentTimeStamp.RealValue * TICKS_PER_WHOLE;
      ticks.push(tick);
      for (const g of this.notesUnderCursor()) this.noteTicks.set(g, tick);
      cursor.next();
    }
    cursor.reset();
    cursor.hide();
    return ticks;
  }

  highlightAt(tick: number): void {
    const cursor = this.osmd.cursor;
    if (!cursor) return;
    let target = -1;
    for (let k = 0; k < this.stepTicks.length && (this.stepTicks[k] ?? Infinity) <= tick + 1e-6; k++) target = k;
    if (target === this.step || target < 0) return;
    if (target < this.step || this.step < 0) {
      cursor.reset();
      cursor.show();
      this.step = 0;
    }
    while (this.step < target) {
      cursor.next();
      this.step++;
    }
    this.unlight();
    this.lit = this.notesUnderCursor();
    for (const g of this.lit) g.classList.add(PLAYING_CLASS);
  }

  tickAt(target: EventTarget | null): number | null {
    for (let node = target instanceof Element ? target : null; node && node !== this.container; node = node.parentElement) {
      const tick = this.noteTicks.get(node);
      if (tick !== undefined) return tick;
    }
    return null;
  }

  private notesUnderCursor(): SVGGElement[] {
    return (this.osmd.cursor?.GNotesUnderCursor() ?? []).flatMap((n) =>
      n instanceof VexFlowGraphicalNote ? [n.getSVGGElement()] : [],
    );
  }

  clearHighlight(): void {
    this.unlight();
    this.osmd.cursor?.reset();
    this.osmd.cursor?.hide();
    this.step = -1;
  }

  private unlight(): void {
    for (const g of this.lit) g.classList.remove(PLAYING_CLASS);
    this.lit = [];
  }
}
