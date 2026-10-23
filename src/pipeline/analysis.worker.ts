/// <reference lib="webworker" />
import { getBackend, loadGraphModel, ready, type GraphModel } from '@tensorflow/tfjs';
import { TrowaError } from '../domain';
import type { AnalysisMessage, AnalysisReply, AnalysisRequest } from './analysis';
import { detectNotes } from './pitch';
import { leadEmphasis, requestStem } from './separate';
import { leadShare, stemCarriesLead, trackSignature } from './signature';
import { decodeWav, encodeWav, type MonoPcm } from './wav';

declare const self: DedicatedWorkerGlobalScope;

let model: Promise<GraphModel> | null = null;
let mix: MonoPcm | null = null;
let lead: Float32Array | null = null;

function held(): MonoPcm {
  if (!mix) throw new Error('analysis worker: no track held');
  return mix;
}

const post = (message: AnalysisMessage) => self.postMessage(message);

async function handle(id: number, request: AnalysisRequest): Promise<AnalysisReply[AnalysisRequest['op']]> {
  switch (request.op) {
    case 'load': {
      model = loadGraphModel(request.modelUrl).catch((err: unknown) => {
        throw new TrowaError('network', `model load: ${String(err)}`);
      });
      model.catch(() => {});
      await ready();
      return getBackend();
    }
    case 'hold':
      mix = { samples: request.samples, sampleRate: request.sampleRate };
      lead = null;
      return trackSignature(mix);
    case 'emphasize':
      lead = leadEmphasis(held());
      return leadShare(held().samples, lead);
    case 'demucs': {
      const bytes = await requestStem(encodeWav(held()).buffer, request.endpoint);
      const stem = bytes === null ? null : decodeWav(bytes);
      if (stem === null || stem.sampleRate !== held().sampleRate) return null;
      const share = leadShare(held().samples, stem.samples);
      if (!stemCarriesLead(share)) return null;
      lead = stem.samples;
      return share;
    }
    case 'detect': {
      if (!model || !lead) throw new Error('analysis worker: detect needs a loaded model and a lead');
      return detectNotes(
        model,
        lead,
        (fraction) => post({ id, kind: 'progress', fraction }),
        (notes, throughSec) => post({ id, kind: 'found', notes, throughSec }),
      );
    }
  }
}

self.onmessage = async ({ data }: MessageEvent<{ id: number } & AnalysisRequest>) => {
  try {
    post({ id: data.id, kind: 'done', value: await handle(data.id, data) });
  } catch (err) {
    post({
      id: data.id,
      kind: 'failed',
      message: err instanceof Error ? err.message : String(err),
      errorKind: err instanceof TrowaError ? err.kind : null,
    });
  }
};
