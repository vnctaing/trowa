#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."

backup=$(mktemp -d)
trap 'rm -rf "$backup"' EXIT

mutate() {
  local file=$1 from=$2 to=$3 tests=$4
  cp "$file" "$backup/original"
  if ! python3 -c 'import sys; p, a, b = sys.argv[1:4]; s = open(p).read(); assert a in s; open(p, "w").write(s.replace(a, b, 1))' "$file" "$from" "$to"; then
    echo "!! mutation target not found in $file: $from"
    return
  fi
  echo "## $file: $(echo "$from" | head -1 | sed 's/^ *//') -> $(echo "$to" | head -1 | sed 's/^ *//')"
  local result
  result=$(npx vitest run "$tests" 2>&1)
  if echo "$result" | grep -q 'Tests .*failed'; then
    echo "$result" | grep -E '^\s+×|AssertionError' | head -3
  else
    echo "!! SURVIVED: no test failed"
  fi
  cp "$backup/original" "$file"
}

mutate src/pipeline/melody.ts 'while (m < FLUTE_LOW) m += 12;' '' src/pipeline/melody.test.ts
mutate src/pipeline/melody.ts '0.01 * note.midi' '0' src/pipeline/melody.test.ts
mutate src/pipeline/melody.ts 'if (s > best[f]!)' 'if (s < best[f]! || best[f]! === -Infinity)' src/pipeline/melody.test.ts
mutate src/pipeline/melody.ts 'if (isTail) {' 'if (false) {' src/pipeline/melody.test.ts
mutate src/pipeline/melody.ts '(revealed ? REVEALED_MIN_SEC : MIN_BLIP_SEC)' 'MIN_BLIP_SEC' src/pipeline/melody.test.ts
mutate src/pipeline/melody.ts 'if (leadsIntoNext) out.push' 'if (false) out.push' src/pipeline/melody.test.ts
mutate src/pipeline/key.ts 'bestMajorTonic = (tonic + 3) % 12;' 'bestMajorTonic = tonic;' src/pipeline/key.test.ts
mutate src/pipeline/key.ts 'const v = (((pitchClass * 7) % 12) + 12) % 12;' 'const v = pitchClass % 12;' src/pipeline/key.test.ts
mutate src/pipeline/quantize.ts '      end = articulationTarget;' '' src/pipeline/quantize.test.ts
mutate src/pipeline/quantize.ts 'out.push({ midi: null, startTick: end' 'void ({ midi: null, startTick: end' src/pipeline/quantize.test.ts
mutate src/pipeline/quantize.ts 'if (triple <= quadruple * TRIPLE_METER_MARGIN)' 'if (false)' src/pipeline/quantize.test.ts
mutate src/pipeline/quantize.ts '* prior' '* 1' src/pipeline/quantize.test.ts
mutate src/pipeline/musicxml.ts 'tieStart: i < pieces.length - 1' 'tieStart: false' src/pipeline/musicxml.test.ts
mutate src/pipeline/musicxml.ts 'const segment = Math.min(startTick + durTicks, (bar + 1) * barTicks) - pos;' 'const segment = startTick + durTicks - pos;' src/pipeline/musicxml.test.ts
mutate src/pipeline/musicxml.ts 'current !== alter ?' 'false ?' src/pipeline/musicxml.test.ts
mutate src/pipeline/score.ts 'keyFifths: majorTonicToFifths(tonic + semitones)' 'keyFifths: score.keyFifths' src/pipeline/score.test.ts
mutate src/pipeline/score.ts "options.key === 'auto' ? estimateKeyFifths(notes) : options.key" 'estimateKeyFifths(notes)' src/pipeline/score.test.ts
mutate src/pipeline/score.ts 'if (confidence < MIN_CONFIDENCE) throw' 'if (false) throw' src/pipeline/score.test.ts
mutate server/youtube.js "if (durationSec > MAX_TRACK_SECONDS) return { error: 'too_long' };" '' server/youtube.test.js
