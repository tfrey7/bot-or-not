#!/usr/bin/env bash
set -euo pipefail

# Generate one persona-medallion icon end-to-end:
#   1. Look up wash/accent/silhouette in assets/persona-icons/specs.json
#   2. Render the orb via the generate-image skill (cream-paper source)
#   3. Strip the cream paper with rembg → final transparent <slug>.png
#
# Usage:
#   ./scripts/gen-persona-orb.sh <slug>
#   ./scripts/gen-persona-orb.sh superfan
#   ./scripts/gen-persona-orb.sh doomer+politics    # blend, sorted-alpha key

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ASSETS_DIR="$PROJECT_ROOT/assets/persona-icons"
SHIPPED_DIR="$PROJECT_ROOT/icons/persona"
SPECS="$ASSETS_DIR/specs.json"
GEN_IMAGE="$HOME/.claude/skills/generate-image/gen-image.sh"
REMBG="$HOME/.local/share/rembg-venv/bin/rembg"

STYLE_REF_1="$ASSETS_DIR/noir-medallion-politics.png"
STYLE_REF_2="$ASSETS_DIR/noir-medallion-shill.png"

mkdir -p "$SHIPPED_DIR"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <slug>" >&2
  echo "  e.g.  $0 superfan" >&2
  echo "        $0 doomer+politics   # blend (sorted alphabetical pair)" >&2
  exit 1
fi

slug="$1"

spec=$(jq -c --arg slug "$slug" '
  .primaries[$slug] // .blends[$slug] // empty
' "$SPECS")

if [ -z "$spec" ] || [ "$spec" = "null" ]; then
  echo "Error: no spec for slug '$slug' in $SPECS" >&2
  echo "Add an entry under .primaries or .blends and rerun." >&2
  exit 1
fi

wash=$(echo "$spec" | jq -r '.wash')
accent=$(echo "$spec" | jq -r '.accent')
silhouette=$(echo "$spec" | jq -r '.silhouette')

prompt="Hand-drawn ink-wash and pencil illustration on aged cream paper, in the style of the reference images. Heavy black ink-wash silhouettes, soft pencil grain texture, painterly brush edges. Single dramatic color accent.

Format: A perfectly circular medallion centered on a square canvas. The circle is filled with a deep ${wash} noir wash as the inner background. Inside the circle, a solid PURE BLACK ink-wash silhouette — NO visible facial features. Match the silhouette discipline of the reference medallions. Faint hand-inked circle border. Outside the circle: cream paper with subtle aged pencil grain. No background scenery.

Subject silhouette: ${silhouette} The bright element glows brighter ${accent} as the ONLY bright accent in the image.

Absolutely no fedora and no popped-collar trenchcoat — those silhouettes belong only to the noir detective character. No text, no caption, no labels."

file_slug="${slug//+/_}"
source_file="$ASSETS_DIR/noir-medallion-${slug}.png"
final_file="$SHIPPED_DIR/${file_slug}.png"

echo "→ Generating cream-paper source: $source_file"
"$GEN_IMAGE" \
  --ref "$STYLE_REF_1" \
  --ref "$STYLE_REF_2" \
  "$source_file" \
  "$prompt" \
  1024x1024

echo "→ Stripping cream paper → $final_file"
"$REMBG" i "$source_file" "$final_file"

echo "✓ Done: $final_file"
