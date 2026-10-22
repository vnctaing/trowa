import type { Mount } from '../context';
import { el } from '../dom';
import { ERROR_COPY } from '../errors';

export const mountError: Mount<'error'> = (root, state, ctx) => {
  const copy = ERROR_COPY[state.kind];
  const back = el('button', {
    class: 'btn',
    type: 'button',
    text: 'Try another song',
    onclick: () => ctx.dispatch({ type: 'startedOver' }),
  });
  root.replaceChildren(
    el('section', { class: 'screen error-screen', role: 'alert', 'data-error': state.kind }, [
      el('div', { class: 'wordmark', text: 'Trowa' }),
      el('div', { class: 'error-card' }, [
        el('div', { class: 'error-mark', text: 'A rest, not the end.' }),
        el('h1', { text: copy.title }),
        el('p', { text: copy.body }),
        back,
      ]),
    ]),
  );
  back.focus();
  return { update() {}, unmount() {} };
};
