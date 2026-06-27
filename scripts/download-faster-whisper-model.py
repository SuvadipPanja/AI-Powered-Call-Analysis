#!/usr/bin/env python3
"""Download Systran/faster-whisper-large-v3 (CTranslate2) into models/."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "models" / "faster-whisper-large-v3"


def main() -> int:
    print(f"Downloading to {TARGET} ...")
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("Install: pip install huggingface_hub")
        return 1

    snapshot_download(
        repo_id="Systran/faster-whisper-large-v3",
        local_dir=str(TARGET),
    )
    print("Done. Add to ai-mvp/.env:")
    print(f"FASTER_WHISPER_MODEL_PATH={TARGET.as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
