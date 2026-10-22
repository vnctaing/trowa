import { STAGES, type DetectedNote, type Score, type StageId } from '../../domain';
import { TrackListener } from '../../particles/audio';
import type { Formation, StaffDrawing } from '../../particles/formations';
import type { Mount } from '../context';
import { el } from '../dom';
import { classify } from '../errors';
import { firstMeasure, measureTicks } from '../music';

const CLOUD_BEFORE_NEBULA_MS = 2400;
const LANDING_MS = 1500;
const LANDING_HOLD_MS = 1300;
const TRACK_VOLUME = 0.12;
const NOTATING_HEADS = 9;

type Visuals = { audioAt: number | null; notes: readonly DetectedNote[] | null; landed: Score | null };

function detectedStaff(notes: readonly DetectedNote[] | null): StaffDrawing {
  const heads = (notes ?? []).slice(0, NOTATING_HEADS).map((n, i, all) => ({
    midi: n.midi,
    x: all.length > 1 ? i / (all.length - 1) : 0.5,
    filled: true,
    stem: true,
  }));
  return { heads, keyFifths: 0, meter: null, barlines: false };
}

function firstBarStaff(score: Score): StaffDrawing {
  const bar = measureTicks(score);
  const notes = firstMeasure(score);
  const barStart = notes[0] ? Math.floor(notes[0].startTick / bar) * bar : 0;
  const heads = notes.flatMap((n) =>
    n.midi === null
      ? []
      : [{ midi: n.midi, x: (n.startTick - barStart) / bar + 0.04, filled: n.durTicks < 8, stem: n.durTicks < 16 }],
  );
  return { heads, keyFifths: score.keyFifths, meter: [score.beatsPerBar, score.beatUnit], barlines: true };
}

function formationFor(stage: StageId, v: Visuals, now: number): { key: string; formation: Formation } {
  if (v.landed) return { key: 'landed', formation: { kind: 'staff', drawing: firstBarStaff(v.landed) } };
  switch (stage) {
    case 'extracting':
      return v.audioAt === null || now - v.audioAt < CLOUD_BEFORE_NEBULA_MS
        ? { key: 'cloud', formation: { kind: 'cloud' } }
        : { key: 'nebula', formation: { kind: 'nebula' } };
    case 'separating':
      return { key: 'streams', formation: { kind: 'streams' } };
    case 'detecting':
      return { key: `lanes:${v.notes?.length ?? 0}`, formation: { kind: 'lanes', notes: v.notes ?? [] } };
    case 'notating':
      return { key: `staff:${v.notes?.length ?? 0}`, formation: { kind: 'staff', drawing: detectedStaff(v.notes) } };
  }
}

function stageLabel(stage: StageId): string {
  return STAGES.find((s) => s.id === stage)?.label ?? '';
}

export const mountTranslating: Mount<'translating'> = (root, initial, ctx) => {
  const field = ctx.field.acquire();
  const listener = new TrackListener(ctx.audio(), TRACK_VOLUME);
  field.listen(listener);

  const visuals: Visuals = { audioAt: null, notes: null, landed: null };
  let state = initial;
  let formationKey = '';
  const timers: number[] = [];
  const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));

  const applyFormation = () => {
    const { key, formation } = formationFor(state.stage, visuals, performance.now());
    if (key === formationKey) return;
    formationKey = key;
    field.setFormation(formation, key === 'landed' ? LANDING_MS : 1100);
  };

  const labelBox = el('div', { class: 'stage-label', 'aria-live': 'polite' });
  const progress = el('div', { class: 'progress-line' });
  let shownLabel = '';
  const showLabel = (text: string) => {
    if (text === shownLabel) return;
    shownLabel = text;
    for (const old of labelBox.querySelectorAll('span:not(.is-leaving)')) {
      old.classList.add('is-leaving');
      later(900, () => old.remove());
    }
    const span = el('span', { class: 'is-entering', text });
    labelBox.append(span);
    requestAnimationFrame(() => requestAnimationFrame(() => span.classList.remove('is-entering')));
  };

  const abort = new AbortController();
  ctx.pipeline
    .runPipeline(
      state.source,
      state.options,
      (event) => {
        switch (event.type) {
          case 'stage':
            ctx.dispatch({ type: 'stageReached', stage: event.stage });
            return;
          case 'progress':
            ctx.dispatch({ type: 'progressed', stage: event.stage, fraction: event.fraction });
            return;
          case 'audio':
            listener.play(event.buffer);
            visuals.audioAt = performance.now();
            later(CLOUD_BEFORE_NEBULA_MS + 20, applyFormation);
            return;
          case 'notes':
            visuals.notes = event.notes;
            applyFormation();
            return;
        }
      },
      abort.signal,
    )
    .then((score) => {
      if (abort.signal.aborted) return;
      visuals.landed = score;
      ctx.dispatch({ type: 'landed', rendered: { score, musicXml: ctx.pipeline.toMusicXml(score) } });
      later(LANDING_MS + LANDING_HOLD_MS, () => ctx.dispatch({ type: 'landingFinished' }));
    })
    .catch((err: unknown) => {
      const failure = classify(err);
      if (failure.kind === 'failed' && !abort.signal.aborted) ctx.dispatch({ type: 'failed', kind: failure.error });
    });

  const update = (next: typeof state) => {
    state = next;
    const index = STAGES.findIndex((s) => s.id === next.stage);
    const overall = next.landed ? 1 : (index + Math.min(1, next.fraction)) / STAGES.length;
    progress.style.transform = `scaleX(${overall})`;
    showLabel(stageLabel(next.stage));
    applyFormation();
  };

  root.replaceChildren(
    el('section', { class: 'screen translating-screen' }, [
      el('div', { class: 'track-title', text: initial.source.title }),
      el('button', {
        class: 'btn btn-quiet cancel',
        type: 'button',
        text: 'Cancel',
        onclick: () => ctx.dispatch({ type: 'startedOver' }),
      }),
      el('div', { class: 'stage-dock' }, [labelBox, el('div', { class: 'progress-track' }, [progress])]),
    ]),
  );
  update(initial);

  return {
    update,
    unmount() {
      abort.abort();
      timers.forEach(clearTimeout);
      listener.stop(0.9);
      field.listen(null);
    },
  };
};
