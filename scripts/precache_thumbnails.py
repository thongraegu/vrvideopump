#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.config import THUMBNAILS_DIR
from app.videos import _thumbnail_key, get_thumbnail, iter_videos_recursive


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Pre-generate VR Video Pump thumbnails.")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Regenerate thumbnails even when the cache file already exists.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only print the videos that would be processed.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
    total = 0
    generated = 0
    skipped = 0
    failed = 0

    source = "remote"
    videos = iter_videos_recursive(source)
    print(f"{source}: found {len(videos)} video(s)")

    for index, video in enumerate(videos, start=1):
        total += 1
        thumbnail_path = THUMBNAILS_DIR / f"{_thumbnail_key(video)}.jpg"
        label = f"[{index}/{len(videos)}] {source}: {video.path}"

        if args.dry_run:
            print(label)
            continue

        if args.force and thumbnail_path.exists():
            thumbnail_path.unlink()

        if thumbnail_path.exists():
            skipped += 1
            print(f"skip {label}")
            continue

        print(f"make {label}")
        if get_thumbnail(video.id):
            generated += 1
        else:
            failed += 1
            print(f"fail {label}")

    if args.dry_run:
        print(f"dry run complete: {total} video(s)")
        return 0

    print(f"complete: {generated} generated, {skipped} already cached, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
