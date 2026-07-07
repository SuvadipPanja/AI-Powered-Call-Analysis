"""Download Qwen3 AWQ models + pack prod bundles. Resumes partial downloads."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "production" / "volumes" / "models"
BUNDLES = ROOT / "production" / "model-bundles"
BUNDLES.mkdir(parents=True, exist_ok=True)

MODELS_SPEC = [
    ("Qwen/Qwen3-14B-AWQ", "Qwen3-14B-AWQ", "14-qwen3-14b-awq.tar"),
    ("Qwen/Qwen3-8B-AWQ", "Qwen3-8B-AWQ", "15-qwen3-8b-awq.tar"),
]


def model_complete(model_dir: Path) -> bool:
    single = model_dir / "model.safetensors"
    if single.is_file() and single.stat().st_size > 1_000_000:
        return True
    index_path = model_dir / "model.safetensors.index.json"
    if not index_path.is_file():
        return False
    data = json.loads(index_path.read_text(encoding="utf-8"))
    shards = sorted(set(data.get("weight_map", {}).values()))
    for shard in shards:
        p = model_dir / shard
        if not p.is_file() or p.stat().st_size == 0:
            print(f"  missing shard: {shard}")
            return False
    return True


def download(repo: str, dest: Path) -> None:
    from huggingface_hub import snapshot_download

    print(f"==> downloading {repo} -> {dest}")
    snapshot_download(repo_id=repo, local_dir=str(dest), max_workers=4)
    print(f"==> download finished: {repo}")


def pack_tar(dir_name: str, tar_name: str) -> None:
    src = MODELS / dir_name
    if not model_complete(src):
        print(f"!! skip tar {tar_name} — incomplete")
        return
    out = BUNDLES / tar_name
    if out.is_file():
        out.unlink()
    print(f"==> packing {tar_name}")
    subprocess.run(
        [
            "tar",
            f"--exclude={dir_name}/.git",
            f"--exclude={dir_name}/.cache",
            "-cf",
            str(out),
            dir_name,
        ],
        cwd=MODELS,
        check=True,
    )
    gb = out.stat().st_size / (1024**3)
    print(f"==> {tar_name} ({gb:.2f} GB)")


def main() -> int:
    for repo, dir_name, tar_name in MODELS_SPEC:
        dest = MODELS / dir_name
        dest.mkdir(parents=True, exist_ok=True)
        if model_complete(dest):
            print(f"==> {dir_name} already complete")
        else:
            try:
                download(repo, dest)
            except Exception as exc:  # noqa: BLE001
                print(f"ERROR downloading {repo}: {exc}", file=sys.stderr)
                return 1
            if not model_complete(dest):
                print(f"ERROR: {dir_name} still incomplete after download", file=sys.stderr)
                return 1
        pack_tar(dir_name, tar_name)

    emo = MODELS / "emotion2vec_plus_large" / "model.pt"
    emo_tar = BUNDLES / "16-emotion2vec-plus-large.tar"
    if emo.is_file():
        if not emo_tar.is_file():
            print("==> packing 16-emotion2vec-plus-large.tar")
            subprocess.run(
                [
                    "tar",
                    "--exclude=emotion2vec_plus_large/.git",
                    "--exclude=emotion2vec_plus_large/.cache",
                    "-cf",
                    str(emo_tar),
                    "emotion2vec_plus_large",
                ],
                cwd=MODELS,
                check=True,
            )
            gb = emo_tar.stat().st_size / (1024**3)
            print(f"==> 16-emotion2vec-plus-large.tar ({gb:.2f} GB)")
        else:
            print("==> 16-emotion2vec-plus-large.tar already exists")
    else:
        print("!! emotion2vec model.pt missing")

    print("DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
