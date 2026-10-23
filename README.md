# Trowa

Turn a song into a printable flute sheet. Paste a YouTube link or drop an MP3/WAV, watch the particles translate it, then play back, transpose, and download the score as PDF or MusicXML.

## Run it

Requires Node 22, plus `yt-dlp` and `ffmpeg` on `PATH` for YouTube links. `uv` is optional and enables Demucs separation.

```sh
npm install
PORT=5310 npm run dev
```

Open `http://localhost:5310/`. Add `?fake` to drive the UI with a canned score and no audio work.

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `5173` | Server port. |
| `TROWA_DEMUCS` | on | Set to `off` to skip Demucs and use the in-browser lead filter. |

## How it works

1. **Extract.** The server fetches YouTube audio with `yt-dlp` and caches it under `.cache/`. Uploaded files decode in the browser.
2. **Separate.** The server runs Demucs (`--two-stems=vocals`) through `uvx`. If Demucs is unavailable, the browser applies a mid-channel band-pass filter instead.
3. **Detect.** Spotify's Basic Pitch runs in the browser on TensorFlow.js.
4. **Track the lead.** The worker keeps Basic Pitch's frame and onset activations and runs a Viterbi search over them: one pitch state per semitone from G2 to C7 plus an unvoiced state. Staying on a pitch is free, changing pitch costs a fixed amount plus a little per semitone, and entering or leaving silence costs too, so a sustained voice wins over an arpeggio that is louder frame by frame. Higher pitches get a small bonus. A second pass penalizes pitches far from the register the first pass settled on, which keeps the line on the flute when the piano doubles it an octave below. Runs of one pitch become notes; a sharp rise in the onset activation splits a repeated note.
5. **Notate.** The line moves notes detected an octave away from their phrase back into it and folds into C4 to C7. The melody sheet joins held notes that got split, plays legato through gaps of up to a beat, and snaps to eighths. The ornaments sheet snaps to 16ths and keeps grace notes. The key comes from a Krumhansl profile. The result is MusicXML, rendered with OpenSheetMusicDisplay and exported with jsPDF.

`src/domain.ts` holds the shared types. `src/pipeline/` holds the pure stages, `src/ui/`, `src/particles/` and `src/result/` hold the screens, and `server/index.js` holds the API.

## Known limits

- Transcriptions of full mixes miss or add notes. When the accompaniment doubles the lead an octave below, Basic Pitch weakens the lead's activation and the line can drop an octave for a phrase. A piano chord tone that rings during a rest can show up as a held note.
- Tempo detection on slow, rubato tracks can be several percent off.
- Demucs harms clean single-line input such as a synthesized melody. Use `TROWA_DEMUCS=off` for that.
- A cold Demucs run on CPU takes about 4.5 minutes for a 3.5 minute track.

## Benchmark

`scripts/bench/` measures the melody line against exact ground truth. `synth.ts` renders eight public-domain tunes three ways (lead alone, with chords, bass and drums, and with a louder piano figure an octave below the lead) and writes the truth beside each WAV. `dump.ts` runs Basic Pitch once per track and caches the activations under `.cache/activations/`. `run.ts` replays the notation stages on the cached activations and prints, per track, precision and recall of the pitch over time, the share of wrong, octave and in-rest notes, onset hits, tempo ratio, notes per bar and whether the score is exact. The headline is F0.5, which weights precision twice as much as recall. `--approach baseline` runs the old salience reducer kept in `legacy-salience.ts` for comparison.

```sh
npx tsx scripts/bench/synth.ts
for f in .cache/bench/*.wav; do n=$(basename "$f" .wav); npx tsx scripts/bench/dump.ts "$n" "$f" --filter; done
npx tsx scripts/bench/run.ts --approach tracker
```

`inspect.ts <track> --from <sec> --to <sec>` prints the truth, the tracked line and the score side by side for one window.

`real.ts` scores real recordings in three tiers (flute alone, flute with accompaniment, melody on another instrument). `scripts/bench/real/manifest.json` lists each recording and score with its source URL and license; the files themselves live under `.cache/real/<slug>/` as `mix.wav` and `score.mid` and are not committed. The melody track of the MIDI is aligned to the recording by DTW over Basic Pitch's pitch-class activations, and the report shows the alignment fit next to the scores.

## Test

```sh
npm test
npm run typecheck
```

`scripts/player-pitch-check.ts` checks the player's audio. Download the WAV with the Audio button and the score with the MusicXML button (or run `node scripts/sheet-download.mjs <server> <youtube url> <dir>` to do both headlessly), then run `npx tsx scripts/player-pitch-check.ts song.wav song.musicxml`. It estimates the pitch in the middle of every note and exits non-zero unless each one matches the score.
