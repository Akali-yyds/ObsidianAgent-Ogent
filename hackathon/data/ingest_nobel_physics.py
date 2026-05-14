#!/usr/bin/env python3
"""
Ingest Nobel Prize in Physics laureates from Wikipedia into a markdown vault.

Uses the Wikipedia Category API to enumerate laureates. Handles HTTP 429
rate-limiting with exponential backoff. Skips files that already exist so
you can re-run after a partial failure without refetching everything.

Usage:
    python ingest_nobel_physics.py [output_dir] [--sleep SECS] [--force]

    --sleep SECS  Base delay between requests (default: 0.5)
    --force       Refetch articles even if the markdown file already exists
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import requests
from markdownify import markdownify

WIKI_API = "https://en.wikipedia.org/w/api.php"
CATEGORY = "Category:Nobel_laureates_in_Physics"
USER_AGENT = "open-agent-hackathon/0.1 (eval-fixture-builder; contact: github.com/your-repo)"

MIN_ARTICLE_BYTES = 800
MAX_RETRIES = 5

session = requests.Session()
session.headers.update({"User-Agent": USER_AGENT})


def slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    return s.strip("-")


def api_get(params: dict, base_sleep: float) -> dict | None:
    """
    GET with retry/backoff for 429 and 5xx. Returns parsed JSON on success,
    None on permanent failure. Honors Retry-After header when present.
    """
    delay = base_sleep
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = session.get(WIKI_API, params=params, timeout=30)
        except requests.RequestException as e:
            if attempt == MAX_RETRIES:
                print(f"      request failed after {attempt} attempts: {e}", flush=True)
                return None
            time.sleep(delay)
            delay *= 2
            continue

        if r.status_code == 200:
            try:
                return r.json()
            except ValueError:
                return None

        # Rate-limited or server error → back off and retry
        if r.status_code in (429, 502, 503, 504):
            retry_after = r.headers.get("Retry-After")
            wait = float(retry_after) if retry_after and retry_after.isdigit() else delay
            wait = max(wait, delay)
            print(f"      HTTP {r.status_code}, sleeping {wait:.1f}s (attempt {attempt}/{MAX_RETRIES})",
                  flush=True)
            time.sleep(wait)
            delay = min(delay * 2, 60)
            continue

        # Other status: don't retry
        print(f"      HTTP {r.status_code} (no retry)", flush=True)
        return None

    return None


def get_laureate_names(base_sleep: float) -> list[str]:
    """Enumerate all pages in the Nobel Physics laureate category."""
    names: list[str] = []
    cmcontinue: str | None = None

    while True:
        params = {
            "action": "query",
            "list": "categorymembers",
            "cmtitle": CATEGORY,
            "cmtype": "page",
            "cmnamespace": "0",
            "cmlimit": "500",
            "format": "json",
            "formatversion": "2",
        }
        if cmcontinue:
            params["cmcontinue"] = cmcontinue

        data = api_get(params, base_sleep)
        if not data:
            raise RuntimeError("Failed to enumerate category — check network")

        for member in data.get("query", {}).get("categorymembers", []):
            names.append(member["title"])

        cont = data.get("continue", {}).get("cmcontinue")
        if not cont:
            break
        cmcontinue = cont
        time.sleep(base_sleep)

    return names


def fetch_article_html(title: str, base_sleep: float) -> tuple[str | None, str | None]:
    params = {
        "action": "parse",
        "page": title,
        "prop": "text",
        "format": "json",
        "formatversion": "2",
        "redirects": "1",
    }
    data = api_get(params, base_sleep)
    if data is None:
        return None, "request failed (see logs above)"
    if "error" in data:
        return None, f"API error: {data['error'].get('info', 'unknown')}"
    html = data.get("parse", {}).get("text")
    if not html:
        return None, "no text in response"
    return html, None


def clean_html(html: str) -> str:
    html = re.sub(r'<span class="mw-editsection.*?</span>', "", html, flags=re.DOTALL)
    html = re.sub(r'<sup[^>]*class="reference"[^>]*>.*?</sup>', "", html, flags=re.DOTALL)
    html = re.sub(
        r'<table[^>]*class="[^"]*\b(infobox|navbox|metadata|sidebar|ambox|wikitable)\b[^"]*"[^>]*>.*?</table>',
        "", html, flags=re.DOTALL,
    )
    html = re.sub(
        r'<div[^>]*class="[^"]*\b(navbox|reflist|references|hatnote|thumb|gallery|toc)\b[^"]*"[^>]*>.*?</div>',
        "", html, flags=re.DOTALL,
    )
    html = re.sub(r'<style[^>]*>.*?</style>', "", html, flags=re.DOTALL)
    html = re.sub(r'<span[^>]*class="[^"]*\bIPA\b[^"]*"[^>]*>.*?</span>', "", html, flags=re.DOTALL)
    return html


def to_markdown(html: str) -> str:
    md = markdownify(html, heading_style="ATX", strip=["a", "img"])
    md = re.sub(r"\n{3,}", "\n\n", md)
    md = re.split(
        r"\n##\s+(See also|References|Notes|Footnotes|Citations|Sources|Further reading|External links|Bibliography|Awards and honours|Honours)\b",
        md, maxsplit=1,
    )[0]
    return md.strip() + "\n"


def write_laureate(name: str, out_dir: Path, base_sleep: float) -> tuple[dict | None, str | None]:
    html, err = fetch_article_html(name, base_sleep)
    if html is None:
        return None, err

    cleaned = clean_html(html)
    md = to_markdown(cleaned)

    if len(md) < MIN_ARTICLE_BYTES:
        return None, f"too short after cleanup ({len(md)} bytes)"

    front_matter = (
        f"---\n"
        f'title: "{name}"\n'
        f'source: "https://en.wikipedia.org/wiki/{name.replace(" ", "_")}"\n'
        f"tags: [nobel-physics, wikipedia]\n"
        f"---\n\n"
        f"# {name}\n\n"
    )
    slug = slugify(name)
    path = out_dir / f"{slug}.md"
    path.write_text(front_matter + md, encoding="utf-8")
    return {
        "name": name,
        "slug": slug,
        "path": str(path.relative_to(out_dir.parent)),
        "bytes": path.stat().st_size,
    }, None


def main():
    parser = argparse.ArgumentParser(description="Ingest Nobel Physics laureates from Wikipedia.")
    parser.add_argument("output_dir", nargs="?", default="vault",
                        help="Output directory (default: ./vault)")
    parser.add_argument("--sleep", type=float, default=0.5,
                        help="Base delay between requests in seconds (default: 0.5)")
    parser.add_argument("--force", action="store_true",
                        help="Refetch articles even if the markdown file already exists")
    args = parser.parse_args()

    out_root = Path(args.output_dir)
    laureates_dir = out_root / "laureates"
    laureates_dir.mkdir(parents=True, exist_ok=True)

    print(f"Enumerating {CATEGORY} via Wikipedia API...", flush=True)
    names = get_laureate_names(args.sleep)
    print(f"Found {len(names)} laureates. Base sleep: {args.sleep}s\n", flush=True)

    written: list[dict] = []
    skipped: list[dict] = []
    failed: list[dict] = []
    resumed = 0

    for i, name in enumerate(names, 1):
        slug = slugify(name)
        existing = laureates_dir / f"{slug}.md"

        # Resume: skip files we already have, unless --force
        if existing.exists() and not args.force:
            resumed += 1
            written.append({
                "name": name,
                "slug": slug,
                "path": str(existing.relative_to(out_root)),
                "bytes": existing.stat().st_size,
            })
            print(f"  [{i:3d}/{len(names)}] = {name} (already on disk, skipping fetch)", flush=True)
            continue

        try:
            result, err = write_laureate(name, laureates_dir, args.sleep)
            if result:
                written.append(result)
                print(f"  [{i:3d}/{len(names)}] ✓ {name} ({result['bytes']:>6} bytes)", flush=True)
            elif err and "too short" in err:
                skipped.append({"name": name, "reason": err})
                print(f"  [{i:3d}/{len(names)}] - {name} (stub: {err})", flush=True)
            else:
                failed.append({"name": name, "error": err or "unknown"})
                print(f"  [{i:3d}/{len(names)}] ✗ {name} (FETCH FAILED: {err})", flush=True)
        except Exception as e:
            failed.append({"name": name, "error": str(e)})
            print(f"  [{i:3d}/{len(names)}] ✗ {name} (EXCEPTION: {e})", flush=True)

        time.sleep(args.sleep)

    index_lines = [
        "---",
        'title: "Nobel Prize in Physics — Index"',
        "tags: [nobel-physics, index]",
        "---",
        "",
        "# Nobel Prize in Physics Laureates",
        "",
        f"This vault contains {len(written)} Wikipedia articles on Nobel laureates in Physics, ",
        "ingested for the OpenAgent grounded-research eval harness.",
        "",
        "## Laureates",
        "",
    ]
    for entry in sorted(written, key=lambda e: e["name"]):
        index_lines.append(f"- [[laureates/{entry['slug']}|{entry['name']}]]")
    (out_root / "index.md").write_text("\n".join(index_lines) + "\n", encoding="utf-8")

    manifest = {
        "source_category": f"https://en.wikipedia.org/wiki/{CATEGORY}",
        "candidate_count": len(names),
        "fetched_count": len(written),
        "resumed_count": resumed,
        "skipped_count": len(skipped),
        "failed_count": len(failed),
        "files": written,
        "skipped": skipped,
        "failed": failed,
    }
    (out_root / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"\nDone.", flush=True)
    print(f"  On disk: {len(written)} articles ({resumed} resumed from previous run)", flush=True)
    print(f"  Skipped: {len(skipped)} (real stubs)", flush=True)
    print(f"  Failed:  {len(failed)}", flush=True)

    if failed:
        print(f"\nFailed articles — re-run the script to retry them:")
        for f in failed[:10]:
            print(f"  - {f['name']}: {f['error']}")
        if len(failed) > 10:
            print(f"  ... and {len(failed) - 10} more (see manifest.json)")


if __name__ == "__main__":
    main()
