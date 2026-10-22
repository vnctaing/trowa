import type { Options, Source } from '../../domain';
import type { Mount } from '../context';
import { el } from '../dom';
import { classify } from '../errors';
import type { Lookup } from '../state';

const AUDIO_FILE = /\.(mp3|wav)$/i;
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']);
const TYPING_DEBOUNCE_MS = 450;

function isAudioFile(file: File): boolean {
  return AUDIO_TYPES.has(file.type) || AUDIO_FILE.test(file.name);
}

function formatBytes(bytes: number): string {
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function sourceCard(source: Source, onTranslate: () => void): HTMLElement {
  const thumb =
    source.kind === 'youtube'
      ? el('img', { class: 'thumb', src: source.thumbnail, alt: '' })
      : el('div', { class: 'thumb', text: source.file.name.split('.').pop()?.toUpperCase() ?? 'AUDIO' });
  const sub = source.kind === 'youtube' ? source.author : `${source.file.name} · ${formatBytes(source.file.size)}`;
  return el('div', { class: 'source-card' }, [
    thumb,
    el('div', { class: 'source-meta' }, [
      el('div', { class: 'source-title', text: source.title }),
      el('div', { class: 'source-sub', text: sub }),
    ]),
    el('button', { class: 'btn btn-primary', type: 'button', onclick: onTranslate, text: 'Translate' }),
  ]);
}

function segmented<T extends string>(
  label: string,
  choices: readonly { value: T; label: string }[],
  onPick: (value: T) => void,
): { root: HTMLElement; sync: (value: T) => void } {
  const buttons = choices.map((c) =>
    el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => onPick(c.value), text: c.label }),
  );
  return {
    root: el('div', { class: 'segmented', role: 'group', 'aria-label': label }, buttons),
    sync: (value) => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(choices[i]?.value === value))),
  };
}

function transposeLabel(semitones: number): string {
  if (semitones === 0) return 'Auto';
  return `${semitones > 0 ? '+' : '−'}${Math.abs(semitones)} st`;
}

function optionsPanel(onChange: (patch: Partial<Options>) => void, onToggle: () => void) {
  const transposeOut = el('output', { 'aria-live': 'polite' });
  let current: Options | null = null;
  const step = (delta: number) => {
    if (!current) return;
    onChange({ transpose: Math.max(-12, Math.min(12, current.transpose + delta)) });
  };
  const difficulty = segmented(
    'Difficulty',
    [
      { value: 'melody', label: 'Melody only' },
      { value: 'ornaments', label: 'With ornaments' },
    ] as const,
    (value) => onChange({ difficulty: value }),
  );
  const tempo = el('input', {
    type: 'number',
    inputmode: 'numeric',
    min: 30,
    max: 260,
    placeholder: 'Auto',
    'aria-label': 'Tempo in beats per minute',
  });
  tempo.addEventListener('change', () => {
    const bpm = Math.round(Number(tempo.value));
    onChange({ tempoOverride: tempo.value.trim() && bpm >= 30 && bpm <= 260 ? bpm : null });
  });
  const toggle = el('button', { class: 'options-toggle', type: 'button', 'aria-expanded': 'false', onclick: onToggle }, [
    el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }),
    'Options',
  ]);
  const root = el('section', { class: 'options', 'data-open': 'false' }, [
    toggle,
    el('div', { class: 'options-body' }, [
      el('div', { class: 'options-inner' }, [
        el('div', { class: 'option-row' }, [
          el('div', { class: 'option-label' }, ['Key', el('small', { text: 'Keep the detected key, or shift it' })]),
          el('div', { class: 'stepper' }, [
            el('button', { type: 'button', 'aria-label': 'Transpose down a semitone', onclick: () => step(-1), text: '−' }),
            transposeOut,
            el('button', { type: 'button', 'aria-label': 'Transpose up a semitone', onclick: () => step(1), text: '+' }),
          ]),
        ]),
        el('div', { class: 'option-row' }, [
          el('div', { class: 'option-label' }, ['Difficulty', el('small', { text: 'Grace notes and trills are optional' })]),
          difficulty.root,
        ]),
        el('div', { class: 'option-row' }, [
          el('div', { class: 'option-label' }, ['Tempo', el('small', { text: 'Leave empty to detect it' })]),
          el('label', { class: 'tempo-field' }, [tempo, 'BPM']),
        ]),
      ]),
    ]),
  ]);
  return {
    root,
    sync(options: Options, open: boolean) {
      current = options;
      root.dataset.open = String(open);
      toggle.setAttribute('aria-expanded', String(open));
      root.querySelector('.options-body')?.toggleAttribute('inert', !open);
      transposeOut.textContent = transposeLabel(options.transpose);
      difficulty.sync(options.difficulty);
      if (document.activeElement !== tempo) tempo.value = options.tempoOverride === null ? '' : String(options.tempoOverride);
    },
  };
}

function hintFor(lookup: Lookup): string {
  switch (lookup.kind) {
    case 'unrecognized':
      return 'That doesn’t look like a YouTube link or an MP3/WAV file.';
    case 'checking':
      return 'Looking it up…';
    case 'empty':
    case 'ready':
      return '';
  }
}

export const mountInput: Mount<'input'> = (root, initial, ctx) => {
  const field = ctx.field.acquire();
  field.setFormation({ kind: 'idle' }, 1200);

  let lookupAbort: AbortController | null = null;
  let typingTimer = 0;
  let state = initial;

  const lookup = (raw: string) => {
    const text = raw.trim();
    lookupAbort?.abort();
    clearTimeout(typingTimer);
    if (!text) {
      ctx.dispatch({ type: 'inputCleared' });
      return;
    }
    const abort = new AbortController();
    lookupAbort = abort;
    ctx.dispatch({ type: 'lookupStarted', text });
    ctx.pipeline.lookupYoutube(text, abort.signal).then(
      (info) =>
        ctx.dispatch({
          type: 'lookupResolved',
          text,
          source: { kind: 'youtube', url: text, ...info },
        }),
      (err: unknown) => {
        const failure = classify(err);
        if (failure.kind === 'aborted' || abort.signal.aborted) return;
        if (failure.error === 'invalid_url') ctx.dispatch({ type: 'lookupUnrecognized', text });
        else ctx.dispatch({ type: 'failed', kind: failure.error });
      },
    );
  };

  const chooseFile = (file: File) => {
    lookupAbort?.abort();
    clearTimeout(typingTimer);
    input.value = '';
    if (isAudioFile(file)) ctx.dispatch({ type: 'fileChosen', file });
    else {
      ctx.dispatch({ type: 'lookupStarted', text: file.name });
      ctx.dispatch({ type: 'lookupUnrecognized', text: file.name });
    }
  };

  const translate = () => {
    void ctx.audio().resume();
    ctx.dispatch({ type: 'translateRequested' });
  };

  const input = el('input', {
    class: 'source-input',
    type: 'text',
    inputmode: 'url',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'Paste a YouTube link or drop an audio file (MP3/WAV)',
    'aria-label': 'YouTube link or audio file',
  });
  input.addEventListener('paste', (e) => {
    const file = e.clipboardData?.files[0];
    if (!file) return;
    e.preventDefault();
    chooseFile(file);
  });
  input.addEventListener('input', (e) => {
    clearTimeout(typingTimer);
    if ((e as InputEvent).inputType === 'insertFromPaste') lookup(input.value);
    else typingTimer = window.setTimeout(() => lookup(input.value), TYPING_DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (state.lookup.kind === 'ready') translate();
    else lookup(input.value);
  });

  const picker = el('input', { type: 'file', accept: '.mp3,.wav,audio/mpeg,audio/wav', class: 'visually-hidden', tabindex: -1 });
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    if (file) chooseFile(file);
    picker.value = '';
  });

  const checking = el('div', { class: 'checking-line', hidden: true });
  const dropzone = el('div', { class: 'dropzone' }, [
    input,
    el('div', { class: 'dropzone-foot' }, [
      el('span', { text: 'YouTube · MP3 · WAV' }),
      el('button', { class: 'link-button', type: 'button', onclick: () => picker.click(), text: 'Choose a file' }),
    ]),
    checking,
    picker,
  ]);
  const hint = el('div', { class: 'hint', 'aria-live': 'polite' });
  const cardSlot = el('div');
  const options = optionsPanel(
    (patch) => ctx.dispatch({ type: 'optionsChanged', patch }),
    () => ctx.dispatch({ type: 'optionsToggled' }),
  );

  const screen = el('section', { class: 'screen input-screen' }, [
    el('div', { class: 'wordmark', text: 'Trowa' }),
    el('div', { class: 'input-stack' }, [
      el('h1', { class: 'headline' }, ['Turn any song into a ', el('em', { text: 'flute sheet' }), '.']),
      dropzone,
      hint,
      cardSlot,
      options.root,
    ]),
  ]);

  let dragDepth = 0;
  const onDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragDepth++;
    dropzone.classList.add('is-dragging');
  };
  const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropzone.classList.remove('is-dragging');
  };
  const onDragOver = (e: DragEvent) => e.preventDefault();
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove('is-dragging');
    const file = e.dataTransfer?.files[0];
    if (file) chooseFile(file);
    else {
      const text = e.dataTransfer?.getData('text/plain');
      if (text) {
        input.value = text;
        lookup(text);
      }
    }
  };
  window.addEventListener('dragenter', onDragEnter);
  window.addEventListener('dragleave', onDragLeave);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);

  let shownSource: Source | null = null;
  const update = (next: typeof state) => {
    state = next;
    hint.textContent = hintFor(next.lookup);
    checking.hidden = next.lookup.kind !== 'checking';
    const source = next.lookup.kind === 'ready' ? next.lookup.source : null;
    if (source !== shownSource) {
      shownSource = source;
      cardSlot.replaceChildren(...(source ? [sourceCard(source, translate)] : []));
    }
    options.sync(next.options, next.optionsOpen);
  };

  root.replaceChildren(screen);
  update(initial);
  input.focus();

  return {
    update,
    unmount() {
      lookupAbort?.abort();
      clearTimeout(typingTimer);
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    },
  };
};
