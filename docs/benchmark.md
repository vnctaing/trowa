# Benchmark

`scripts/bench/` measures the melody line against exact ground truth. `synth.ts` renders eight public-domain tunes three ways (lead alone, with chords, bass and drums, and with a louder piano figure an octave below the lead) and writes the truth beside each WAV. `dump.ts` runs Basic Pitch once per track and caches the activations under `.cache/activations/`. `run.ts` replays the notation stages on the cached activations and prints, per track, precision and recall of the pitch over time, the share of wrong, octave and in-rest notes, onset hits, tempo ratio, notes per bar and whether the score is exact. The headline is F0.5, which weights precision twice as much as recall. `--approach baseline` runs the old salience reducer kept in `legacy-salience.ts` for comparison.

```sh
npx tsx scripts/bench/synth.ts
for f in .cache/bench/*.wav; do n=$(basename "$f" .wav); npx tsx scripts/bench/dump.ts "$n" "$f" --filter; done
npx tsx scripts/bench/run.ts --approach tracker
```

`inspect.ts <track> --from <sec> --to <sec>` prints the truth, the tracked line and the score side by side for one window.

`real.ts` scores real recordings in three tiers (flute alone, flute with accompaniment, melody on another instrument). `scripts/bench/real/manifest.json` lists each recording and score with its source URL and license; `python3 scripts/bench/real/fetch.py` downloads them into `.cache/real/<slug>/` as `mix.wav` and `score.mid`; they are not committed. The melody track of the MIDI is aligned to the recording by DTW over Basic Pitch's pitch-class activations, and the report shows the alignment fit next to the scores. Run it with `npx tsx scripts/bench/real.ts`.

## Results

The synthetic set and Naruto are tuning data. The tracker's parameters were swept on both, and the register pass was added for Naruto bars 10-11. Their gains are in-sample. Only the real recordings are held out. On those, the Viterbi tracker scores against main (757dd7b; its pipeline is unchanged since the fork point 83c02d1) as follows. Tier F0.5 is F0.5 of the mean precision and recall.

| tier | recordings | main F0.5 | tracker F0.5 |
| --- | --- | --- | --- |
| 1, flute alone | 2 | 0.633 | 0.728 |
| 2, flute with accompaniment | 1 | 0.776 | 0.832 |
| 3, melody on another instrument | 2 | 0.484 | 0.630 |

With one or two recordings per tier, these are five data points, not tier estimates.

The held-out data does not clearly support the register pass. Without it, tier 1 rises from 0.728 to 0.754 (both flute solos improve), tier 2 falls from 0.832 to 0.823, and tier 3 falls from 0.630 to 0.591. The whole tier 3 drop comes from the Romanze; Für Elise improves. The pass stays in until the model bakeoff.

On the tuning data, Naruto bars 1-32 go from 0.623 to 0.642 against the old salience reducer, and from 0.386 to 0.642 against main. Bars 12-15 fail. The reference marks them sure, and the tracker scores 0 precision in each of them (`npx tsx scripts/bench/bars.ts` prints the per-bar scores).

