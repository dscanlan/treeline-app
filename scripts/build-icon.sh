#!/usr/bin/env bash
# Re-render resources/icon.icns and resources/icon.png from resources/icon.svg.
# Uses only macOS built-ins (qlmanage, sips, iconutil) — no external deps.
#
# Edit resources/icon.svg, then run this from the project root:
#   ./scripts/build-icon.sh
#
# electron-builder picks up resources/icon.icns automatically (it's the
# convention for `directories.buildResources: resources`). The dev-mode
# Dock override in src/main/index.ts reads resources/icon.png.
set -euo pipefail

cd "$(dirname "$0")/.."

SRC=resources/icon.svg
OUT_PNG=resources/icon.png
OUT_ICNS=resources/icon.icns

if [[ ! -f $SRC ]]; then
  echo "missing $SRC" >&2
  exit 1
fi

work=$(mktemp -d)
trap "rm -rf $work" EXIT

# 1. SVG → 1024 PNG via QuickLook.
#
# qlmanage rasterizes SVGs with a flat WHITE background — the corner pixels
# that should be transparent come out (255,255,255,255). The PNG technically
# has an alpha channel but every pixel is alpha=255. macOS Dock then shows
# the icon with visible white corners around our rounded squircle.
#
# Fix: after rasterizing, we use Python+PIL to overlay a clean rounded-rect
# alpha mask, replacing the bogus white corners with true transparency.
qlmanage -t -s 1024 -o "$work" "$SRC" >/dev/null 2>&1
mv "$work/$(basename "$SRC").png" "$work/icon-1024-raw.png"

# Verify size before the mask step (qlmanage occasionally silently downscales).
read -r w h < <(sips -g pixelWidth -g pixelHeight "$work/icon-1024-raw.png" \
  | awk '/pixel(Width|Height)/ {print $2}' | xargs)
if [[ $w != 1024 || $h != 1024 ]]; then
  echo "qlmanage produced ${w}x${h}, expected 1024x1024" >&2
  exit 1
fi

# Apply the squircle alpha mask. rx=228 matches the SVG (≈22.3% of 1024,
# the Big Sur ratio). PIL's rounded_rectangle gives anti-aliased corners.
python3 - "$work/icon-1024-raw.png" "$work/icon-1024.png" <<'PY'
import sys
from PIL import Image, ImageDraw

src, dst = sys.argv[1], sys.argv[2]
img = Image.open(src).convert('RGBA')
mask = Image.new('L', img.size, 0)
ImageDraw.Draw(mask).rounded_rectangle(
    (0, 0, img.size[0], img.size[1]),
    radius=228,
    fill=255,
)
img.putalpha(mask)
img.save(dst)
PY

# 2. 1024 PNG → all the iconset sizes Apple wants. Read filename + pixel-size
# pairs from a heredoc; avoids `declare -A` (unsupported on macOS bash 3.2).
mkdir -p "$work/icon.iconset"
while read -r name dim; do
  [[ -z $name ]] && continue
  sips -z "$dim" "$dim" "$work/icon-1024.png" \
    --out "$work/icon.iconset/$name" >/dev/null
done <<'SIZES'
icon_16x16.png      16
icon_16x16@2x.png   32
icon_32x32.png      32
icon_32x32@2x.png   64
icon_128x128.png    128
icon_128x128@2x.png 256
icon_256x256.png    256
icon_256x256@2x.png 512
icon_512x512.png    512
SIZES
cp "$work/icon-1024.png" "$work/icon.iconset/icon_512x512@2x.png"

# 3. iconset → .icns
iconutil -c icns "$work/icon.iconset" -o "$work/icon.icns"

# 4. Install into resources/.
cp "$work/icon-1024.png" "$OUT_PNG"
cp "$work/icon.icns" "$OUT_ICNS"

echo "wrote $OUT_PNG $OUT_ICNS"
