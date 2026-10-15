#!/usr/bin/env python3
"""Wrap page.html in a full HTML document and write index.html.

page.html is the source of truth: it holds only the page content (no
doctype, <html>, <head> or <body>), so it can be published as an Artifact.
This script produces index.html, the page GitHub Pages serves.

Leading <title>, <meta> and <link> tags of page.html go into <head>;
everything else goes into <body>.

Usage: python3 -I scripts/build_page.py [--check]
  --check  exit 1 if index.html is out of date (does not write).
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "page.html"
INDEX = ROOT / "index.html"

HEAD_TAG = re.compile(r"\s*(<title>.*?</title>|<meta\b[^>]*>|<link\b[^>]*>)", re.S | re.I)
FORBIDDEN = re.compile(r"<!doctype|<html\b|<head\b|<body\b", re.I)

HEAD_EXTRA = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex,nofollow">',
    '<meta name="theme-color" content="#124a40">',
    '<link rel="icon" href="./favicon.svg" type="image/svg+xml">',
]


def split_page(text):
    """Return (head_tags, body_html) from the page fragment."""
    head, pos = [], 0
    while True:
        match = HEAD_TAG.match(text, pos)
        if not match:
            break
        head.append(match.group(1).strip())
        pos = match.end()
    return head, text[pos:].strip()


def build():
    text = PAGE.read_text(encoding="utf-8")
    if FORBIDDEN.search(text):
        sys.exit("page.html must not contain doctype/html/head/body tags")
    head, body = split_page(text)
    lines = ["<!doctype html>", '<html lang="pt-BR">', "<head>"]
    lines += ["  " + tag for tag in HEAD_EXTRA + head]
    lines += ["</head>", "<body>", body, "</body>", "</html>", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    html = build()
    current = INDEX.read_text(encoding="utf-8") if INDEX.exists() else None
    if args.check:
        print("index.html is up to date" if current == html else "index.html is OUT OF DATE")
        sys.exit(0 if current == html else 1)
    if current != html:
        INDEX.write_text(html, encoding="utf-8")
        print(f"wrote {INDEX} ({len(html.encode('utf-8')):,} bytes)")
    else:
        print("index.html unchanged")


if __name__ == "__main__":
    main()
