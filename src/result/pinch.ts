const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3;

function distance(t: TouchList): number {
  const a = t[0];
  const b = t[1];
  return a && b ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) : 0;
}

function clamp(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function pinchZoom(viewport: HTMLElement, content: HTMLElement): () => void {
  let zoom = 1;
  let gesture: { from: number; zoom: number } | null = null;
  const apply = (z: number) => {
    zoom = clamp(z);
    content.style.zoom = String(zoom);
  };
  const onStart = (e: TouchEvent) => {
    if (e.touches.length === 2) gesture = { from: distance(e.touches), zoom };
  };
  const onMove = (e: TouchEvent) => {
    if (!gesture || e.touches.length !== 2) return;
    e.preventDefault();
    apply((gesture.zoom * distance(e.touches)) / Math.max(1, gesture.from));
  };
  const onEnd = (e: TouchEvent) => {
    if (e.touches.length < 2) gesture = null;
  };
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    apply(zoom * Math.exp(-e.deltaY * 0.01));
  };
  viewport.addEventListener('touchstart', onStart, { passive: true });
  viewport.addEventListener('touchmove', onMove, { passive: false });
  viewport.addEventListener('touchend', onEnd);
  viewport.addEventListener('touchcancel', onEnd);
  viewport.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    viewport.removeEventListener('touchstart', onStart);
    viewport.removeEventListener('touchmove', onMove);
    viewport.removeEventListener('touchend', onEnd);
    viewport.removeEventListener('touchcancel', onEnd);
    viewport.removeEventListener('wheel', onWheel);
  };
}
