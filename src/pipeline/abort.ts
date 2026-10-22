export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('The pipeline was aborted.', 'AbortError');
}
