import type { Score } from '../domain';
import type { Mount } from '../ui/context';
import { el } from '../ui/dom';
import { download, scorePdf, slug } from './pdf';
import { pinchZoom } from './pinch';
import { createPlayer } from './player';
import { ScoreSheet } from './sheet';

const LOW_CONFIDENCE = 0.5;

function transposeText(semitones: number): string {
  if (semitones === 0) return 'Original';
  return `${semitones > 0 ? '+' : '−'}${Math.abs(semitones)} st`;
}

export const mountResult: Mount<'result'> = (root, initial, ctx) => {
  let state = initial;
  let renderedXml = '';
  let renderedScore: Score | null = null;
  let wav: Blob | null = null;

  const zoomContent = el('div', { class: 'score-zoom' });
  const viewport = el('div', { class: 'score-viewport is-rendering', 'aria-label': 'Score' }, [zoomContent]);
  const sheet = new ScoreSheet(zoomContent);
  const releasePinch = pinchZoom(viewport, zoomContent);

  const transpose = (delta: number) => {
    const score = ctx.pipeline.transposeScore(state.score, delta);
    ctx.dispatch({
      type: 'transposed',
      rendered: { score, musicXml: ctx.pipeline.toMusicXml(score) },
      transposedBy: state.transposedBy + delta,
    });
  };

  const pdfButton = el('button', { class: 'btn btn-primary', type: 'button', text: 'Download PDF' });
  pdfButton.addEventListener('click', async () => {
    pdfButton.disabled = true;
    pdfButton.textContent = 'Preparing…';
    try {
      download(await scorePdf(state.musicXml), `${slug(state.score.title)}.pdf`);
    } finally {
      pdfButton.disabled = false;
      pdfButton.textContent = 'Download PDF';
    }
  });

  const xmlButton = el('button', {
    class: 'btn',
    type: 'button',
    text: 'MusicXML',
    title: 'Download MusicXML',
    onclick: () =>
      download(
        new Blob([state.musicXml], { type: 'application/vnd.recordare.musicxml+xml' }),
        `${slug(state.score.title)}.musicxml`,
      ),
  });

  const audioButton = el('button', {
    class: 'btn',
    type: 'button',
    text: 'Audio',
    title: 'Download audio (WAV)',
    disabled: true,
    onclick: () => wav && download(wav, `${slug(state.score.title)}.wav`),
  });

  const player = createPlayer({
    onTick: (tick) => (tick === null ? sheet.clearHighlight() : sheet.highlightAt(tick)),
    onTrack: (track) => {
      wav = track;
      audioButton.disabled = track === null;
    },
  });
  viewport.addEventListener('click', (e) => {
    const tick = sheet.tickAt(e.target);
    if (tick !== null) player.seekToTick(tick);
  });
  const transposeOut = el('output', { 'aria-live': 'polite' });
  const title = el('h1', { class: 'paper-title' });
  const sourceLine = el('div', { class: 'paper-source' });
  const warning = el('div', { class: 'paper-warning', role: 'status' }, [
    el('span', { 'aria-hidden': 'true', text: '◐' }),
    'Dense mix — melody may be incomplete',
  ]);

  const screen = el('section', { class: 'screen result-screen' }, [
    el('div', { class: 'result-bar' }, [
      el('button', {
        class: 'btn btn-quiet',
        type: 'button',
        text: '← Start over',
        onclick: () => ctx.dispatch({ type: 'startedOver' }),
      }),
      el('div', { class: 'result-actions' }, [
        el('div', { class: 'transpose', role: 'group', 'aria-label': 'Transpose' }, [
          el('button', { type: 'button', 'aria-label': 'Transpose down', onclick: () => transpose(-1), text: '−' }),
          transposeOut,
          el('button', { type: 'button', 'aria-label': 'Transpose up', onclick: () => transpose(1), text: '+' }),
        ]),
        xmlButton,
        audioButton,
        pdfButton,
      ]),
    ]),
    el('article', { class: 'paper' }, [
      title,
      sourceLine,
      warning,
      viewport,
      el('div', { class: 'zoom-hint', text: 'Pinch to zoom the score' }),
    ]),
    player.element,
  ]);

  const update = (next: typeof state) => {
    state = next;
    title.textContent = next.score.title;
    sourceLine.textContent = next.score.source;
    warning.hidden = next.score.confidence >= LOW_CONFIDENCE;
    transposeOut.textContent = transposeText(next.transposedBy);
    if (next.score !== renderedScore) {
      renderedScore = next.score;
      player.load(next.score);
    }
    if (next.musicXml !== renderedXml) {
      renderedXml = next.musicXml;
      sheet.clearHighlight();
      const xml = next.musicXml;
      void sheet.render(xml).then(() => {
        if (xml !== renderedXml) return;
        viewport.classList.remove('is-rendering');
        player.repaint();
        void ctx.field.release(1000);
      });
    }
  };

  root.replaceChildren(screen);
  update(initial);

  return {
    update,
    unmount() {
      player.destroy();
      releasePinch();
    },
  };
};
