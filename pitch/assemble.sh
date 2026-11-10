#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
DUR="$(python3 -c "import json; print(json.load(open('build/cues.json'))['duration'])")"
FADE_OUT="$(python3 -c "print(max(0, float('${DUR}') - 2.2))")"
mkdir -p build
ffmpeg -y \
  -framerate 24 \
  -i build/frames/%05d.jpg \
  -i build/vo.wav \
  -i build/bed.wav \
  -filter_complex "[0:v]format=yuv420p[v];[1:a]volume=4dB[vo];[2:a]volume=8dB,afade=t=in:st=0:d=1.1,afade=t=out:st=${FADE_OUT}:d=2[bed];[vo][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.97[a]" \
  -map "[v]" -map "[a]" \
  -c:v libx264 -pix_fmt yuv420p -crf 18 -preset medium -movflags +faststart \
  -c:a aac -ar 48000 -b:a 192k \
  build/aegis-split-pitch.mp4
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 build/aegis-split-pitch.mp4
