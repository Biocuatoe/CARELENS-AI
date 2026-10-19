#!/usr/bin/env bash
# Encode the rendered PNG frames + soundtrack into brag.mp4 (1920x1080, 30 fps, exactly 30 s) and extract the poster.
#   bash scripts/encode.sh <frames_dir> <soundtrack.wav> <out_dir>
set -euo pipefail
FRAMES="${1:?frames dir}"; AUDIO="${2:?audio wav}"; OUT="${3:?out dir}"
ffmpeg -y -hide_banner -loglevel warning \
  -framerate 30 -start_number 0 -i "$FRAMES/f_%04d.png" \
  -i "$AUDIO" \
  -vf "scale=1920:1080:flags=lanczos,format=yuv420p" \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,apad=whole_dur=30" \
  -c:v libx264 -preset slow -crf 15 -profile:v high -level 4.1 -pix_fmt yuv420p -r 30 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 192k -ar 44100 -ac 2 \
  -frames:v 900 -t 30 -movflags +faststart \
  "$OUT/brag.mp4"
# poster = frame zero of the video (the poster composition is baked into frame 0)
ffmpeg -y -hide_banner -loglevel warning -i "$OUT/brag.mp4" -frames:v 1 -update 1 -q:v 2 "$OUT/brag.jpg"
echo "encoded $OUT/brag.mp4"
