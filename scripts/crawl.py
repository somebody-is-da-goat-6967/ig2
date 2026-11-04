#!/usr/bin/env python3
"""Crawl every post of a public Instagram profile into docs/media + docs/data/posts.json.

Incremental: posts already listed in posts.json are skipped, so reruns are cheap.
"""
import base64
import glob
import json
import os
import pathlib
import random
import sys
import time

import instaloader

USERNAME = os.environ.get("IG_USERNAME", "for_everyoung10").strip()
LOGIN_USER = os.environ.get("IG_LOGIN_USER", "").strip()
SESSION_B64 = os.environ.get("IG_SESSION_B64", "").strip()
MAX_POSTS = int(os.environ.get("MAX_POSTS", "0") or 0)  # 0 = no limit

ROOT = pathlib.Path(__file__).resolve().parent.parent
MEDIA_DIR = ROOT / "docs" / "media"
DATA_FILE = ROOT / "docs" / "data" / "posts.json"
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
DATA_FILE.parent.mkdir(parents=True, exist_ok=True)

L = instaloader.Instaloader(
    download_comments=False,
    download_geotags=False,
    save_metadata=False,
    post_metadata_txt_pattern="",
    max_connection_attempts=3,
    request_timeout=60,
    quiet=True,
)

# Optional: authenticated session (Instagram often blocks anonymous requests from datacenter IPs).
if LOGIN_USER and SESSION_B64:
    sess_path = ROOT / ".session"
    sess_path.write_bytes(base64.b64decode(SESSION_B64))
    L.load_session_from_file(LOGIN_USER, str(sess_path))
    print(f"Loaded session for {LOGIN_USER}")
    sess_path.unlink(missing_ok=True)


def load_db():
    if DATA_FILE.exists():
        return json.loads(DATA_FILE.read_text())
    return {"username": USERNAME, "posts": []}


def save_db(db):
    db["username"] = USERNAME
    db["updated"] = int(time.time())
    db["posts"].sort(key=lambda p: p["date"], reverse=True)
    DATA_FILE.write_text(json.dumps(db, ensure_ascii=False, indent=1))


def fetch(url, base, mtime):
    """Download url to base.<ext>; return path relative to docs/ (or None)."""
    existing = glob.glob(str(base) + ".*")
    if not existing:
        L.download_pic(str(base), url, mtime)
        existing = glob.glob(str(base) + ".*")
    if not existing:
        return None
    return pathlib.Path(existing[0]).relative_to(ROOT / "docs").as_posix()


def process(post):
    folder = MEDIA_DIR / USERNAME
    folder.mkdir(parents=True, exist_ok=True)
    sc = post.shortcode
    media = []

    if post.typename == "GraphSidecar":
        nodes = [(n.is_video, n.display_url, n.video_url) for n in post.get_sidecar_nodes()]
    else:
        nodes = [(post.is_video, post.url, post.video_url)]

    for i, (is_video, img_url, vid_url) in enumerate(nodes):
        base = folder / f"{sc}_{i}"
        if is_video and vid_url:
            src = fetch(vid_url, base, post.date_utc)
            poster = fetch(img_url, folder / f"{sc}_{i}_poster", post.date_utc)
            if src:
                media.append({"type": "video", "src": src, "poster": poster})
        else:
            src = fetch(img_url, base, post.date_utc)
            if src:
                media.append({"type": "image", "src": src})

    return {
        "id": post.mediaid,
        "shortcode": sc,
        "date": int(post.date_utc.timestamp()),
        "caption": post.caption or "",
        "likes": post.likes,
        "url": f"https://www.instagram.com/p/{sc}/",
        "media": media,
    }


def main():
    db = load_db()
    known = {p["shortcode"] for p in db["posts"]}
    print(f"{len(known)} posts already archived")

    try:
        profile = instaloader.Profile.from_username(L.context, USERNAME)
    except Exception as e:  # noqa: BLE001
        print(f"Could not load profile {USERNAME}: {e}", file=sys.stderr)
        if not db["posts"]:
            sys.exit(1)
        return

    db["profile"] = {
        "full_name": profile.full_name,
        "biography": profile.biography,
        "followers": profile.followers,
        "mediacount": profile.mediacount,
    }

    new = 0
    try:
        for post in profile.get_posts():
            if post.shortcode in known:
                continue
            try:
                entry = process(post)
            except Exception as e:  # noqa: BLE001
                print(f"  skip {post.shortcode}: {e}", file=sys.stderr)
                continue
            if entry["media"]:
                db["posts"].append(entry)
                new += 1
                print(f"  + {post.shortcode} ({len(entry['media'])} media)")
            if new % 10 == 0:
                save_db(db)  # checkpoint
            if MAX_POSTS and new >= MAX_POSTS:
                break
            time.sleep(random.uniform(1.5, 4))  # be polite
    except Exception as e:  # noqa: BLE001  (rate limit etc. -> keep what we have)
        print(f"Crawl interrupted: {e}", file=sys.stderr)
    finally:
        save_db(db)

    print(f"Done. {new} new posts, {len(db['posts'])} total.")


if __name__ == "__main__":
    main()
