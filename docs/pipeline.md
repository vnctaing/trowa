# Pipeline

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

## Player check

`scripts/player-pitch-check.ts` checks the player's audio. Download the WAV with the Audio button and the score with the MusicXML button (or run `node scripts/sheet-download.mjs <server> <youtube url> <dir>` to do both headlessly), then run `npx tsx scripts/player-pitch-check.ts song.wav song.musicxml`. It estimates the pitch in the middle of every note and exits non-zero unless each one matches the score.
