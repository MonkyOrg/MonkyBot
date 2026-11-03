#!/usr/bin/env bash
# Generated music fixtures run on the FFmpeg build the Monky client installs for listeners
# (yt-dlp/FFmpeg-Builds master-latest), not on whatever FFmpeg the runner's distribution ships:
# the HTTP resume behavior these tests pin down differs between FFmpeg releases.
set -euo pipefail

asset=ffmpeg-master-latest-linux64-gpl
base=https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest
dir="${RUNNER_TEMP:-/tmp}/monky-ffmpeg"

rm -rf "$dir"
mkdir -p "$dir"
curl -fsSL --retry 4 --retry-all-errors -o "$dir/$asset.tar.xz" "$base/$asset.tar.xz"
curl -fsSL --retry 4 --retry-all-errors -o "$dir/checksums.sha256" "$base/checksums.sha256"
(cd "$dir" && grep -E "^[0-9a-f]{64}  $asset\.tar\.xz$" checksums.sha256 | sha256sum --check --strict -)
tar -xJf "$dir/$asset.tar.xz" -C "$dir"

ffmpeg="$dir/$asset/bin/ffmpeg"
"$ffmpeg" -hide_banner -version | head -n 1
echo "MONKY_MUSIC_FFMPEG=$ffmpeg" >> "$GITHUB_ENV"
