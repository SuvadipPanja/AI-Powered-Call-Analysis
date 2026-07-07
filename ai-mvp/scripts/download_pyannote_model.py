"""Download pyannote/speaker-diarization-3.1 (+ deps) for air-gap prod seeding."""

from __future__ import annotations

import os
import time
from pathlib import Path

from huggingface_hub import snapshot_download

TOKEN_PATH = Path.home() / ".cache" / "huggingface" / "token"
ROOT = Path(__file__).resolve().parents[2] / "production" / "volumes" / "models" / "pyannote"
MODELS: list[tuple[str, str]] = [
    ("pyannote/speaker-diarization-3.1", "speaker-diarization-3.1"),
    ("pyannote/segmentation-3.0", "segmentation-3.0"),
    ("pyannote/wespeaker-voxceleb-resnet34-LM", "wespeaker-voxceleb-resnet34-LM"),
]
ALLOW = [
    "config.yaml",
    "*.bin",
    "*.pt",
    "*.pth",
    "*.safetensors",
    "*.json",
    "*.txt",
    "README.md",
    ".gitattributes",
    "pytorch_model.bin",
]


def _download_repo(repo_id: str, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    last_err: Exception | None = None
    for attempt in range(1, 8):
        try:
            print(f"Attempt {attempt} -> {dest}")
            path = snapshot_download(
                repo_id,
                local_dir=str(dest),
                allow_patterns=ALLOW,
                max_workers=1,
                resume_download=True,
            )
            print(f"  OK: {path}")
            return
        except Exception as exc:
            last_err = exc
            print(f"  Error: {exc}")
            time.sleep(min(30, 5 * attempt))
    raise RuntimeError(f"Failed to download {repo_id}") from last_err


def _patch_pipeline_config() -> None:
    cfg_path = ROOT / "speaker-diarization-3.1" / "config.yaml"
    text = cfg_path.read_text(encoding="utf-8")
    text = text.replace(
        "embedding: pyannote/wespeaker-voxceleb-resnet34-LM",
        "embedding: /models/pyannote/wespeaker-voxceleb-resnet34-LM/pytorch_model.bin",
    )
    text = text.replace(
        "embedding: /models/pyannote/wespeaker-voxceleb-resnet34-LM",
        "embedding: /models/pyannote/wespeaker-voxceleb-resnet34-LM/pytorch_model.bin",
    )
    text = text.replace(
        "segmentation: pyannote/segmentation-3.0",
        "segmentation: /models/pyannote/segmentation-3.0/pytorch_model.bin",
    )
    text = text.replace(
        "segmentation: /models/pyannote/segmentation-3.0",
        "segmentation: /models/pyannote/segmentation-3.0/pytorch_model.bin",
    )
    cfg_path.write_text(text, encoding="utf-8")
    print("Patched config.yaml for offline /models/pyannote/*/pytorch_model.bin paths")


def main() -> None:
    if TOKEN_PATH.exists() and not os.getenv("HF_TOKEN"):
        os.environ["HF_TOKEN"] = TOKEN_PATH.read_text(encoding="utf-8").strip()
        print("Using cached Hugging Face token")
    elif os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN"):
        print("Using HF token from environment")
    else:
        print("No token — gated models may fail until you run: huggingface-cli login")

    for repo_id, folder in MODELS:
        print(f"\n==> {repo_id}")
        _download_repo(repo_id, ROOT / folder)

    _patch_pipeline_config()
    total = sum(1 for _ in ROOT.rglob("*") if _.is_file())
    print(f"\nAll models ready under {ROOT} ({total} files)")


if __name__ == "__main__":
    main()
