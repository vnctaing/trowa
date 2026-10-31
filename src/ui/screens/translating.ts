import { STAGES, type Score, type StageId } from '../../domain';
import { TrackListener } from '../../particles/audio';
import type { Formation, StaffDrawing } from '../../particles/formations';
import { Song, sourceSeed } from '../../particles/song';
import type { Mount } from '../context';
import { el } from '../dom';
import { classify } from '../errors';
import { firstMeasure, measureTicks } from '../music';

const STAGE_DWELL_MS = 1800;
const PACING_TICK_MS = 150;
const LANDING_MS = 1500;
const LANDING_HOLD_MS = 1300;
const TRACK_VOLUME = 0.12;

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

function songFormation(stage: Exclude<StageId, 'notating'>, song: Song): Formation {
  switch (stage) {
    case 'extracting':
      return { kind: 'nebula', song };
    case 'separating':
      return { kind: 'streams', song };
    case 'detecting':
      return { kind: 'roll', song };
  }
}

const stageIndex = (stage: StageId) => STAGES.findIndex((s) => s.id === stage);

export const mountTranslating: Mount<'translating'> = (root, initial, ctx) => {
  const field = ctx.field.acquire();
  const listener = new TrackListener(ctx.audio(), TRACK_VOLUME);
  const song = new Song(sourceSeed(initial.source), () => listener.position());
  field.listen(listener);
  field.reseed(song.seed);

  let state = initial;
  let shown: { stage: StageId; since: number } = { stage: initial.stage, since: performance.now() };
  let landing = false;
  const timers: number[] = [];
  const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));

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

  const render = () => {
    const index = stageIndex(shown.stage);
    const fraction = landing ? 1 : shown.stage === state.stage ? Math.min(1, state.fraction) : 1;
    progress.style.transform = `scaleX(${(index + fraction) / STAGES.length})`;
    screen.dataset.phase = state.landed ? 'landing' : state.stage;
    screen.dataset.shown = landing ? 'landing' : shown.stage;
    showLabel(STAGES[index]?.label ?? '');
  };

  const show = (stage: StageId) => {
    shown = { stage, since: performance.now() };
    if (stage !== 'notating') field.setFormation(songFormation(stage, song));
    render();
  };

  const land = (score: Score) => {
    landing = true;
    field.setFormation({ kind: 'staff', drawing: firstBarStaff(score) }, LANDING_MS);
    render();
    later(LANDING_MS + LANDING_HOLD_MS, () => ctx.dispatch({ type: 'landingFinished' }));
  };

  const pace = () => {
    if (landing || performance.now() - shown.since < STAGE_DWELL_MS) return;
    const target = state.landed ? 'notating' : state.stage;
    if (stageIndex(shown.stage) < stageIndex(target)) show(STAGES[stageIndex(shown.stage) + 1]!.id);
    else if (shown.stage === 'notating' && state.landed) land(state.landed.score);
  };
  const pacing = window.setInterval(pace, PACING_TICK_MS);

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
            return;
          case 'signature':
          case 'lead':
          case 'notesFound':
            song.apply(event, performance.now() / 1000);
            return;
        }
      },
      abort.signal,
    )
    .then((score) => {
      if (abort.signal.aborted) return;
      ctx.dispatch({ type: 'landed', rendered: { score, musicXml: ctx.pipeline.toMusicXml(score) } });
    })
    .catch((err: unknown) => {
      const failure = classify(err);
      if (failure.kind === 'failed' && !abort.signal.aborted) ctx.dispatch({ type: 'failed', kind: failure.error });
    });

  const update = (next: typeof state) => {
    state = next;
    render();
  };

  const screen = el('section', { class: 'screen translating-screen' }, [
    el('div', { class: 'track-title', text: initial.source.title }),
    el('button', {
      class: 'btn btn-quiet cancel',
      type: 'button',
      text: 'Cancel',
      onclick: () => ctx.dispatch({ type: 'startedOver' }),
    }),
    el('div', { class: 'stage-dock' }, [labelBox, el('div', { class: 'progress-track' }, [progress])]),
  ]);
  root.replaceChildren(screen);
  show(initial.stage);

  return {
    update,
    unmount() {
      abort.abort();
      timers.forEach(clearTimeout);
      clearInterval(pacing);
      listener.stop(0.9);
      field.listen(null);
    },
  };
};
