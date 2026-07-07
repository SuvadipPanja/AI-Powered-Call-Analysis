"""Create a clean Pyannote offline bundle (no HF .cache / lock files)."""

from __future__ import annotations

import argparse
import tarfile
from pathlib import Path

KEEP_NAMES = {
    "config.yaml",
    "pytorch_model.bin",
    "README.md",
    "requirements.txt",
}

SKIP_DIRS = {".cache", ".github", "reproducible_research", "__pycache__"}


def collect_files(src: Path) -> list[tuple[Path, str]]:
    out: list[tuple[Path, str]] = []
    for path in sorted(src.rglob("*")):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.name.endswith(".lock") or path.name.endswith(".incomplete"):
            continue
        if path.name not in KEEP_NAMES and not path.name.endswith(".gitattributes"):
            continue
        arc = str(path.relative_to(src)).replace("\\", "/")
        out.append((path, arc))
    return out


def write_extract_script(dest: Path) -> None:
    dest.write_text(
        """#!/usr/bin/env bash
# Extract Pyannote offline bundle into production volumes.
set -euo pipefail
PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
BUNDLE="${1:-$PROD_ROOT/model-bundles/pyannote-offline-bundle.tar.gz}"
TARGET="$PROD_ROOT/volumes/models/pyannote"
mkdir -p "$TARGET"
echo "Extracting $BUNDLE -> $TARGET"
tar -xzf "$BUNDLE" -C "$TARGET"
echo "Done. Contents:"
find "$TARGET" -type f \\( -name 'config.yaml' -o -name 'pytorch_model.bin' \\) | sort
""",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--extract-script", type=Path, required=True)
    args = parser.parse_args()

    files = collect_files(args.src)
    if not any(a.endswith("pytorch_model.bin") for _, a in files):
        raise SystemExit("ERROR: bundle missing pytorch_model.bin weights")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(args.out, "w:gz") as tar:
        for path, arc in files:
            tar.add(path, arcname=arc)

    write_extract_script(args.extract_script)
    total_mb = sum(p.stat().st_size for p, _ in files) / (1024 * 1024)
    print(f"Bundled {len(files)} files ({total_mb:.1f} MB) -> {args.out}")


if __name__ == "__main__":
    main()
