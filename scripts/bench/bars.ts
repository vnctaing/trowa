import { parseArgs } from 'node:util';
import { measure } from './metric';
import { narutoTruth } from './naruto';
import { APPROACHES, candidate } from './run';

const { values } = parseArgs({
  options: { approach: { type: 'string', default: 'tracker' }, name: { type: 'string', default: 'naruto-filter' } },
});
const truth = narutoTruth();
const cand = candidate(values.name, APPROACHES[values.approach]!);
const bars = [...new Set(truth.notes.map((n) => n.bar))];
const beatSec = 60 / truth.bpm;
const f = (x: number) => x.toFixed(2);
console.log(`${values.approach} on ${values.name}: per bar precision/recall (exact), wrong share, in-rest share`);
for (const bar of bars) {
  const first = truth.notes.find((n) => n.bar === bar)!;
  const barStart = first.startSec - ((first.startSec - truth.windowSec[0]) % (beatSec * truth.beatsPerBar));
  const window: [number, number] = [barStart, barStart + beatSec * truth.beatsPerBar];
  const m = measure(cand, { ...truth, windowSec: window });
  const conf = first.confidence.padEnd(6);
  console.log(
    `bar ${String(bar).padStart(2)} ${conf} P ${f(m.precision)} R ${f(m.recall)} wrong ${f(m.wrongNote)} rest ${f(m.restIntrusion)} octave ${f(m.octave)}`,
  );
}
const skip12to15 = {
  ...truth,
  skipSec: [[truth.notes.find((n) => n.bar === 12)!.startSec, truth.notes.find((n) => n.bar === 16)!.startSec]] as [number, number][],
};
const m = measure(cand, skip12to15);
console.log(`without bars 12-15: headline ${f(m.headline)} precision ${f(m.precision)} recall ${f(m.recall)} wrong ${f(m.wrongNote)}`);
