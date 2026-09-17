#!/usr/bin/env bash

set -euo pipefail

upstream_repository="https://github.com/aegis-icons/aegis-icons"
upstream_api="https://api.github.com/repos/aegis-icons/aegis-icons"
requested_ref="${1:-master}"
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_directory="$project_root/assets/aegis-icons"
temporary_directory="$(mktemp -d)"

cleanup() {
  rm -rf "$temporary_directory"
}
trap cleanup EXIT

revision="$(
  curl -fsSL "$upstream_api/commits/$requested_ref" |
    jq -er '.sha | select(test("^[0-9a-f]{40}$"))'
)"
archive="$temporary_directory/aegis-icons.tar.gz"
extracted="$temporary_directory/extracted"
staging="$temporary_directory/staging"

curl -fsSL "$upstream_repository/archive/$revision.tar.gz" -o "$archive"
mkdir -p "$extracted" "$staging"
tar -xzf "$archive" -C "$extracted"

source_root="$(find "$extracted" -mindepth 1 -maxdepth 1 -type d -name 'aegis-icons-*' -print -quit)"
if [[ -z "$source_root" || ! -d "$source_root/icons" ]]; then
  echo "Unable to find the Aegis Icons directory in the downloaded archive." >&2
  exit 1
fi

cp -R "$source_root/icons/." "$staging/"
icon_count="$(find "$staging" -type f -name '*.svg' | wc -l | tr -d ' ')"
if (( icon_count < 500 )); then
  echo "Refusing to replace the icon set with only $icon_count SVG files." >&2
  exit 1
fi

mkdir -p "$target_directory"
rsync -a --delete "$staging/" "$target_directory/"
cp "$source_root/LICENSE.md" "$target_directory/LICENSE.md"
cp "$source_root/README.md" "$target_directory/README.md"
printf '%s\n' "$revision" > "$target_directory/UPSTREAM_COMMIT"

echo "Imported $icon_count SVGs from $upstream_repository at $revision."
