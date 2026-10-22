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
4. **Notate.** The notes reduce to one line, fold into C4 to C7, and snap to 16ths at the detected tempo. The key comes from a Krumhansl profile. The result is MusicXML, rendered with OpenSheetMusicDisplay and exported with jsPDF.

`src/domain.ts` holds the shared types. `src/pipeline/` holds the pure stages, `src/ui/`, `src/particles/` and `src/result/` hold the screens, and `server/index.js` holds the API.

## Known limits

- Transcriptions of full mixes are choppy. On "Never Gonna Give You Up", about 92% of notes are an eighth or shorter, with or without Demucs.
- Demucs harms clean single-line input such as a synthesized melody. Use `TROWA_DEMUCS=off` for that.
- A cold Demucs run on CPU takes about 4.5 minutes for a 3.5 minute track.

## Test

```sh
npm test
npm run typecheck
```
