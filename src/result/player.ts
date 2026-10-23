import type { Score } from '../domain';
import { encodeWav } from '../pipeline/wav';
import { el } from '../ui/dom';
import { secondsPerTick } from '../ui/music';
import { renderFlute } from './flute';

const SPEEDS = [0.5, 0.75, 1] as const;
const KEY_SEEK_SEC = 5;
const SVG_NS = 'http://www.w3.org/2000/svg';

type Track = { wav: Blob; secondsPerTick: number };
type Status = { kind: 'preparing' } | { kind: 'ready'; track: Track } | { kind: 'failed' };

export type Player = {
  element: HTMLElement;
  load: (score: Score) => void;
  seekToTick: (tick: number) => void;
  repaint: () => void;
  destroy: () => void;
};

type Hooks = {
  onTick: (tick: number | null) => void;
  onTrack: (wav: Blob | null) => void;
};

function clock(sec: number): string {
  const whole = Math.max(0, Math.floor(sec));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function glyph(d: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

function ignoresSpace(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input:not([type="range"]), textarea, select, button, a, [contenteditable="true"]') !== null
  );
}

export function createPlayer({ onTick, onTrack }: Hooks): Player {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.preservesPitch = true;
  let status: Status = { kind: 'preparing' };
  let generation = 0;
  let frame = 0;

  const play = el('button', { class: 'player-play', type: 'button' }, [
    glyph('M8 5.5v13l10.5-6.5z'),
    glyph('M7 5h3.5v14H7zM13.5 5H17v14h-3.5z'),
  ]);
  const scrubber = el('input', {
    class: 'player-scrubber',
    type: 'range',
    min: '0',
    max: '0',
    step: 'any',
    value: '0',
    'aria-label': 'Seek',
  });
  const elapsed = el('span', { class: 'player-elapsed', text: '0:00' });
  const total = el('span', { class: 'player-total', text: '0:00' });
  const note = el('span', { class: 'player-note', 'aria-live': 'polite' });
  const speedButtons = SPEEDS.map((rate) =>
    el('button', {
      type: 'button',
      text: `${rate}×`,
      'aria-pressed': String(rate === 1),
      onclick: () => setSpeed(rate),
    }),
  );
  const element = el('div', { class: 'player', role: 'region', 'aria-label': 'Player' }, [
    play,
    el('div', { class: 'player-time' }, [elapsed, el('span', { class: 'player-sep', text: '/' }), total]),
    note,
    scrubber,
    el('div', { class: 'player-speed', role: 'group', 'aria-label': 'Speed' }, speedButtons),
  ]);

  const setSpeed = (rate: number) => {
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    speedButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(SPEEDS[i] === rate)));
  };

  const paint = () => {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const t = Math.min(audio.currentTime, duration);
    scrubber.max = String(duration);
    scrubber.value = String(t);
    scrubber.style.setProperty('--progress', duration > 0 ? `${(t / duration) * 100}%` : '0%');
    scrubber.setAttribute('aria-valuetext', `${clock(t)} of ${clock(duration)}`);
    elapsed.textContent = clock(t);
    total.textContent = clock(duration);
    const playing = !audio.paused;
    element.classList.toggle('is-playing', playing);
    play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    onTick(status.kind === 'ready' && (playing || t > 0) && !audio.ended ? t / status.track.secondsPerTick : null);
  };

  const follow = () => {
    paint();
    frame = audio.paused ? 0 : requestAnimationFrame(follow);
  };

  const showStatus = (next: Status) => {
    status = next;
    element.dataset.status = next.kind;
    const ready = next.kind === 'ready';
    play.disabled = !ready;
    scrubber.disabled = !ready;
    note.textContent = next.kind === 'preparing' ? 'Preparing audio…' : next.kind === 'failed' ? 'Audio unavailable' : '';
    onTrack(ready ? next.track.wav : null);
  };

  const toggle = () => {
    if (status.kind !== 'ready') return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  const seek = (sec: number) => {
    if (status.kind !== 'ready') return;
    audio.currentTime = Math.max(0, Math.min(sec, audio.duration || 0));
    paint();
  };

  play.addEventListener('click', toggle);
  scrubber.addEventListener('input', () => seek(Number(scrubber.value)));
  scrubber.addEventListener('keydown', (e) => {
    const target = {
      ArrowLeft: audio.currentTime - KEY_SEEK_SEC,
      ArrowDown: audio.currentTime - KEY_SEEK_SEC,
      ArrowRight: audio.currentTime + KEY_SEEK_SEC,
      ArrowUp: audio.currentTime + KEY_SEEK_SEC,
      Home: 0,
      End: audio.duration,
    }[e.key];
    if (target === undefined) return;
    e.preventDefault();
    seek(target);
  });
  audio.addEventListener('play', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(follow);
  });
  audio.addEventListener('pause', paint);
  audio.addEventListener('seeked', paint);
  audio.addEventListener('ended', () => {
    audio.currentTime = 0;
    paint();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || e.repeat || ignoresSpace(e.target)) return;
    e.preventDefault();
    toggle();
  };
  document.addEventListener('keydown', onKey);

  const release = () => {
    if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
  };

  const load = (score: Score) => {
    const mine = ++generation;
    const resumeTick = status.kind === 'ready' ? audio.currentTime / status.track.secondsPerTick : 0;
    const resume = !audio.paused;
    audio.pause();
    showStatus({ kind: 'preparing' });
    renderFlute(score)
      .then((buffer) => {
        if (mine !== generation) return;
        const wav = new Blob([encodeWav({ samples: buffer.getChannelData(0), sampleRate: buffer.sampleRate })], {
          type: 'audio/wav',
        });
        const track: Track = { wav, secondsPerTick: secondsPerTick(score) };
        release();
        audio.src = URL.createObjectURL(wav);
        audio.addEventListener(
          'loadedmetadata',
          () => {
            if (mine !== generation) return;
            audio.currentTime = Math.min(resumeTick * track.secondsPerTick, audio.duration);
            showStatus({ kind: 'ready', track });
            paint();
            if (resume) void audio.play();
          },
          { once: true },
        );
      })
      .catch((err: unknown) => {
        if (mine !== generation) return;
        console.error('[trowa] audio render failed', err);
        showStatus({ kind: 'failed' });
      });
  };

  showStatus(status);
  paint();

  return {
    element,
    load,
    repaint: paint,
    seekToTick: (tick) => {
      if (status.kind === 'ready') seek(tick * status.track.secondsPerTick);
    },
    destroy() {
      generation++;
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      audio.pause();
      release();
      audio.removeAttribute('src');
      audio.load();
    },
  };
}
