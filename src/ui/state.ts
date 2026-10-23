import type { AppState, ErrorKind, Options, Score, Source, StageId } from '../domain';

export const DEFAULT_OPTIONS: Options = {
  transpose: 0,
  key: 'auto',
  difficulty: 'melody',
  tempoOverride: null,
};

export type Lookup =
  | { kind: 'empty' }
  | { kind: 'checking'; text: string }
  | { kind: 'unrecognized'; text: string }
  | { kind: 'ready'; source: Source };

export type Rendered = { score: Score; musicXml: string };

export type UiState =
  | { screen: 'input'; lookup: Lookup; options: Options; optionsOpen: boolean }
  | {
      screen: 'translating';
      source: Source;
      options: Options;
      stage: StageId;
      fraction: number;
      landed: Rendered | null;
    }
  | {
      screen: 'result';
      source: Source;
      score: Score;
      musicXml: string;
      transposedBy: number;
    }
  | { screen: 'error'; kind: ErrorKind };

type Assignable<T extends AppState> = T;
export type UiStateIsAppState = Assignable<UiState>;

export type Action =
  | { type: 'lookupStarted'; text: string }
  | { type: 'lookupResolved'; text: string; source: Source }
  | { type: 'lookupUnrecognized'; text: string }
  | { type: 'inputCleared' }
  | { type: 'fileChosen'; file: File }
  | { type: 'optionsToggled' }
  | { type: 'optionsChanged'; patch: Partial<Options> }
  | { type: 'translateRequested' }
  | { type: 'stageReached'; stage: StageId }
  | { type: 'progressed'; stage: StageId; fraction: number }
  | { type: 'landed'; rendered: Rendered }
  | { type: 'landingFinished' }
  | { type: 'failed'; kind: ErrorKind }
  | { type: 'transposed'; rendered: Rendered; transposedBy: number }
  | { type: 'startedOver' };

export const INITIAL: UiState = {
  screen: 'input',
  lookup: { kind: 'empty' },
  options: DEFAULT_OPTIONS,
  optionsOpen: false,
};

function titleFromFile(file: File): string {
  return file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled';
}

function lookupText(lookup: Lookup): string | null {
  return lookup.kind === 'checking' || lookup.kind === 'unrecognized' ? lookup.text : null;
}

export function reduce(state: UiState, action: Action): UiState {
  switch (action.type) {
    case 'startedOver':
      return INITIAL;
    case 'failed':
      return { screen: 'error', kind: action.kind };
  }

  switch (state.screen) {
    case 'input':
      switch (action.type) {
        case 'lookupStarted':
          return { ...state, lookup: { kind: 'checking', text: action.text } };
        case 'lookupResolved':
          return lookupText(state.lookup) === action.text
            ? { ...state, lookup: { kind: 'ready', source: action.source } }
            : state;
        case 'lookupUnrecognized':
          return lookupText(state.lookup) === action.text
            ? { ...state, lookup: { kind: 'unrecognized', text: action.text } }
            : state;
        case 'inputCleared':
          return { ...state, lookup: { kind: 'empty' } };
        case 'fileChosen':
          return {
            ...state,
            lookup: { kind: 'ready', source: { kind: 'file', file: action.file, title: titleFromFile(action.file) } },
          };
        case 'optionsToggled':
          return { ...state, optionsOpen: !state.optionsOpen };
        case 'optionsChanged':
          return { ...state, options: { ...state.options, ...action.patch } };
        case 'translateRequested':
          return state.lookup.kind === 'ready'
            ? {
                screen: 'translating',
                source: state.lookup.source,
                options: state.options,
                stage: 'extracting',
                fraction: 0,
                landed: null,
              }
            : state;
        default:
          return state;
      }
    case 'translating':
      if (state.landed) {
        return action.type === 'landingFinished'
          ? {
              screen: 'result',
              source: state.source,
              score: state.landed.score,
              musicXml: state.landed.musicXml,
              transposedBy: 0,
            }
          : state;
      }
      switch (action.type) {
        case 'stageReached':
          return { ...state, stage: action.stage, fraction: 0 };
        case 'progressed':
          return action.stage === state.stage ? { ...state, fraction: action.fraction } : state;
        case 'landed':
          return { ...state, stage: 'notating', fraction: 1, landed: action.rendered };
        default:
          return state;
      }
    case 'result':
      switch (action.type) {
        case 'transposed':
          return {
            ...state,
            score: action.rendered.score,
            musicXml: action.rendered.musicXml,
            transposedBy: action.transposedBy,
          };
        default:
          return state;
      }
    case 'error':
      return state;
  }
}
