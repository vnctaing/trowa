import '@fontsource/urbanist/400.css';
import '@fontsource/urbanist/500.css';
import '@fontsource/urbanist/600.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/dm-mono/400.css';
import './styles/app.css';

import { FieldHost } from './particles/host';
import { mountResult } from './result/screen';
import type { AppContext, Pipeline, View } from './ui/context';
import { mountError } from './ui/screens/error';
import { mountInput } from './ui/screens/input';
import { mountTranslating } from './ui/screens/translating';
import { INITIAL, reduce, type Action, type UiState } from './ui/state';

const params = new URLSearchParams(location.search);

async function loadPipeline(): Promise<Pipeline> {
  return params.has('fake') ? import('./dev/fakePipeline') : import('./pipeline');
}

function prefersReducedMotion(): boolean {
  return params.has('reducedMotion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function mountScreen(root: HTMLElement, state: UiState, ctx: AppContext): View<UiState> {
  switch (state.screen) {
    case 'input': {
      const view = mountInput(root, state, ctx);
      return { update: (next) => next.screen === 'input' && view.update(next), unmount: view.unmount };
    }
    case 'translating': {
      const view = mountTranslating(root, state, ctx);
      return { update: (next) => next.screen === 'translating' && view.update(next), unmount: view.unmount };
    }
    case 'result': {
      const view = mountResult(root, state, ctx);
      return { update: (next) => next.screen === 'result' && view.update(next), unmount: view.unmount };
    }
    case 'error': {
      const view = mountError(root, state, ctx);
      return { update: (next) => next.screen === 'error' && view.update(next), unmount: view.unmount };
    }
  }
}

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  const canvas = document.getElementById('field');
  if (!root || !(canvas instanceof HTMLCanvasElement)) throw new Error('index.html is missing #app or #field');
  const reducedMotion = prefersReducedMotion();
  document.documentElement.classList.toggle('reduced-motion', reducedMotion);

  let audio: AudioContext | null = null;
  let state: UiState = INITIAL;
  let view: View<UiState> | null = null;

  const ctx: AppContext = {
    dispatch,
    pipeline: await loadPipeline(),
    field: new FieldHost(canvas, reducedMotion),
    audio: () => (audio ??= new AudioContext()),
  };

  function dispatch(action: Action): void {
    const next = reduce(state, action);
    if (next === state) return;
    const prev = state;
    state = next;
    document.documentElement.dataset.screen = next.screen;
    if (!view || prev.screen !== next.screen) {
      view?.unmount();
      view = mountScreen(root!, next, ctx);
    } else {
      view.update(next);
    }
  }

  document.documentElement.dataset.screen = state.screen;
  view = mountScreen(root, state, ctx);
}

void boot();
