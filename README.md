# Trowa

Turn a song into a printable flute sheet. Paste a YouTube link or drop an MP3/WAV, watch the particles translate it, then play back, transpose, and download the score as PDF or MusicXML.

![Uploading a WAV, the translation animation, and the resulting sheet](docs/media/demo.gif)

The demo is a real run on a synthesized Ode to Joy with chords, bass and drums (`ode-band` from the benchmark). The Demucs separation was cached, so the whole run took 7 seconds. A cold run separates on CPU first and takes minutes.

![The flute sheet Trowa wrote for that track](docs/media/sheet.png)

## Run it

Requires Node 22, plus `yt-dlp` and `ffmpeg` on `PATH` for YouTube links. `uv` is optional and enables Demucs separation.

```sh
npm install
PORT=5310 npm run dev
```

Open `http://localhost:5310/`. Add `?fake` to drive the UI with a canned score and no audio work. Set `TROWA_DEMUCS=off` to skip Demucs and use the in-browser lead filter.

## How it works

1. The server fetches YouTube audio with `yt-dlp`. Uploads decode in the browser.
2. Demucs splits off the lead stem. If the stem is near-silent or Demucs is missing, a band-pass filter stands in.
3. Spotify's Basic Pitch detects pitches in the browser, and a Viterbi tracker follows the lead line through them.
4. The line is quantized, beamed and written as MusicXML, rendered with OpenSheetMusicDisplay and exported with jsPDF.

Full mixes still miss or add notes, and tempo on rubato tracks can be off by a few percent. [docs/pipeline.md](docs/pipeline.md) explains each stage and its limits, and [docs/benchmark.md](docs/benchmark.md) has the benchmark and held-out results.

## Test

```sh
npm test
npm run typecheck
node scripts/demo-capture.mjs http://localhost:5310/ song.wav out/
```

The last command drives the real app headlessly, uploads `song.wav`, and writes the frames, a result screenshot and the sheet image to `out/`. It is how the demo above was made.
