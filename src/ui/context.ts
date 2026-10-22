import type * as RealPipeline from '../pipeline';
import type { FieldHost } from '../particles/host';
import type { Action, UiState } from './state';

export type Pipeline = Pick<typeof RealPipeline, 'runPipeline' | 'transposeScore' | 'toMusicXml' | 'lookupYoutube'>;

export type AppContext = {
  dispatch: (action: Action) => void;
  pipeline: Pipeline;
  field: FieldHost;
  audio: () => AudioContext;
  reducedMotion: boolean;
};

export type ScreenOf<K extends UiState['screen']> = Extract<UiState, { screen: K }>;

export type View<S> = { update: (state: S) => void; unmount: () => void };

export type Mount<K extends UiState['screen']> = (root: HTMLElement, state: ScreenOf<K>, ctx: AppContext) => View<ScreenOf<K>>;
