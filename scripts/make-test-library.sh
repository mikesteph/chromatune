#!/usr/bin/env bash
# Generates a small tagged demo library (with cover art) for trying Chromatune out.
set -euo pipefail
OUT="${1:-testmusic}"
mkdir -p "$OUT"
artists=("Neon Harbor" "Velvet Static" "The Midnight Orchard" "Kaito Mirage" "Aurora Lane" "Glass Animals Club")
genres=("Synthwave" "Shoegaze" "Indie Rock" "Lo-fi" "Dream Pop" "Electronic")
colors=("0xff2a6d:0x05d9e8:0x7700ff" "0xf9c80e:0xf86624:0xea3546" "0x2dd5b7:0x1e66f5:0x0b132b" "0xffcead:0x7d82d9:0x060b1e" "0xa6e3a1:0xcba6f7:0x89b4fa" "0xfe8019:0xfabd2f:0x282828")
fmts=(mp3 flac ogg m4a opus mp3)
words=(Lights Ocean Signal Gravity Velvet Echo Satellite Ember Prism Horizon Static Neon Bloom Orbit Chrome Nova)
i=0
for a in "${!artists[@]}"; do
  artist="${artists[$a]}"
  for al in 1 2; do
    album="$(printf '%s %s' "${words[$(( (a*3+al) % 16 ))]}" "${words[$(( (a*5+al*7) % 16 ))]}")"
    year=$(( 2012 + a + al*2 ))
    dir="$OUT/$artist/$year - $album"
    mkdir -p "$dir"
    IFS=: read -r c0 c1 c2 <<< "${colors[$a]}"
    cover="$dir/cover.jpg"
    ffmpeg -hide_banner -loglevel error -y -f lavfi -i "gradients=s=600x600:c0=$c0:c1=$c1:c2=$c2:n=3:x0=$((al*90)):y0=0:x1=600:y1=$((600-al*120)):seed=$((a*10+al))" -frames:v 1 "$cover"
    fmt="${fmts[$(( (a+al) % 6 ))]}"
    for t in 1 2 3 4; do
      i=$((i+1))
      title="${words[$(( (i*7) % 16 ))]} ${words[$(( (i*3+t) % 16 ))]}"
      f1=$(( 110 + (i*37) % 220 )); f2=$(( f1*3/2 )); f3=$(( f1*2 )); bpm=$(( 2 + (i%4) ))
      expr="0.30*sin(2*PI*$f1*t)*(0.6+0.4*sin(2*PI*$bpm*t))+0.18*sin(2*PI*$f2*t)+0.12*sin(2*PI*$f3*t)*abs(sin(PI*$bpm*t/2))+0.25*sin(2*PI*55*t)*exp(-8*mod(t\,1/$bpm*2))+0.06*(random(0)-0.5)*abs(sin(PI*${bpm}*2*t))"
      file="$dir/$(printf '%02d' $t) - $title.$fmt"
      args=(-hide_banner -loglevel error -y -f lavfi -i "aevalsrc=$expr:s=44100:d=$((24 + (i%5)*6))")
      meta=(-metadata title="$title" -metadata artist="$artist" -metadata album_artist="$artist" -metadata album="$album" -metadata date="$year" -metadata track="$t/4" -metadata genre="${genres[$a]}")
      case "$fmt" in
        mp3)  ffmpeg "${args[@]}" -i "$cover" -map 0:a -map 1:v -c:a libmp3lame -b:a 192k -c:v mjpeg -id3v2_version 3 -disposition:v attached_pic "${meta[@]}" "$file" ;;
        flac) ffmpeg "${args[@]}" -i "$cover" -map 0:a -map 1:v -c:a flac -sample_fmt s16 -c:v mjpeg -disposition:v attached_pic "${meta[@]}" "$file" ;;
        m4a)  ffmpeg "${args[@]}" -i "$cover" -map 0:a -map 1:v -c:a aac -b:a 192k -c:v mjpeg -disposition:v attached_pic "${meta[@]}" "$file" ;;
        *)    ffmpeg "${args[@]}" -c:a libopus -b:a 128k "${meta[@]}" "$file" 2>/dev/null || ffmpeg "${args[@]}" -c:a libvorbis "${meta[@]}" "$file" ;;
      esac
    done
  done
done
echo "Demo library written to $OUT"
