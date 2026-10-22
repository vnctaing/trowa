export type MonoPcm = { samples: Float32Array; sampleRate: number };

export function encodeWav({ samples, sampleRate }: MonoPcm): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return bytes;
}

export function decodeWav(input: ArrayBuffer | Uint8Array): MonoPcm | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;

  let format: { code: number; channels: number; sampleRate: number; bits: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      const code = view.getUint16(body, true);
      format = {
        code: code === 0xfffe ? view.getUint16(body + 24, true) : code,
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    }
    if (id === 'data' && format) {
      const { code, channels, sampleRate, bits } = format;
      const isPcm16 = code === 1 && bits === 16;
      const isFloat32 = code === 3 && bits === 32;
      if (!isPcm16 && !isFloat32) return null;
      const frameBytes = channels * (bits / 8);
      const dataBytes = Math.min(size, bytes.length - body);
      const frames = Math.floor(dataBytes / frameBytes);
      const samples = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const at = body + f * frameBytes + c * (bits / 8);
          sum += isPcm16 ? view.getInt16(at, true) / 0x8000 : view.getFloat32(at, true);
        }
        samples[f] = sum / channels;
      }
      return { samples, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  return null;
}
