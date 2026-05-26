#!/usr/bin/env python3
"""Build a static GitHub Pages version of the Drupal 6 site."""

from __future__ import annotations

import gzip
import html
import os
import posixpath
import re
import shutil
import sys
from collections import defaultdict
from datetime import datetime, UTC
from pathlib import Path
from urllib.parse import quote, urlparse


ROOT = Path(__file__).resolve().parents[1]
SQL_DUMP = ROOT / "industree.sql.gz"
OUT = ROOT / "docs"
TARGET_TABLES = {
    "audio",
    "audio_metadata",
    "boxes",
    "content_type_audio",
    "files",
    "menu_links",
    "node",
    "node_revisions",
    "url_alias",
    "variable",
}


def parse_insert(line: str):
    match = re.match(r"INSERT INTO `([^`]+)` \((.*?)\) VALUES (.*);$", line, re.S)
    if not match:
        return None, None, []
    table = match.group(1)
    columns = [part.strip().strip("`") for part in match.group(2).split(",")]
    return table, columns, parse_values(match.group(3))


def parse_values(text: str):
    rows = []
    i = 0
    n = len(text)

    def parse_token():
        nonlocal i
        if text[i] == "'":
            i += 1
            chars = []
            while i < n:
                ch = text[i]
                if ch == "\\" and i + 1 < n:
                    nxt = text[i + 1]
                    chars.append(
                        {
                            "0": "\0",
                            "b": "\b",
                            "n": "\n",
                            "r": "\r",
                            "t": "\t",
                            "Z": "\x1a",
                            "\\": "\\",
                            "'": "'",
                            '"': '"',
                        }.get(nxt, nxt)
                    )
                    i += 2
                elif ch == "'":
                    i += 1
                    return "".join(chars)
                else:
                    chars.append(ch)
                    i += 1
            return "".join(chars)

        start = i
        while i < n and text[i] not in ",)":
            i += 1
        raw = text[start:i].strip()
        if raw.upper() == "NULL":
            return None
        if raw == "":
            return ""
        try:
            return int(raw)
        except ValueError:
            try:
                return float(raw)
            except ValueError:
                return raw

    while i < n:
        while i < n and text[i] in " \n\t,":
            i += 1
        if i >= n:
            break
        if text[i] != "(":
            raise ValueError(f"Expected tuple at offset {i}: {text[i:i+20]!r}")
        i += 1
        row = []
        while i < n:
            row.append(parse_token())
            if i < n and text[i] == ",":
                i += 1
                continue
            if i < n and text[i] == ")":
                i += 1
                break
        rows.append(row)
    return rows


def read_tables():
    data = {table: [] for table in TARGET_TABLES}
    with gzip.open(SQL_DUMP, "rt", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if not line.startswith("INSERT INTO `"):
                continue
            table_name = line.split("`", 2)[1]
            if table_name not in TARGET_TABLES:
                continue
            table, columns, rows = parse_insert(line.rstrip("\n"))
            if table:
                data[table].extend(dict(zip(columns, row)) for row in rows)
    return data


def php_unserialize_string(value):
    if not isinstance(value, str):
        return value
    match = re.fullmatch(r's:(\d+):"(.*)";', value, re.S)
    if match:
        return match.group(2)
    match = re.fullmatch(r"i:(-?\d+);", value)
    if match:
        return int(match.group(1))
    return value


def clean_path(path: str) -> str:
    path = (path or "").strip().strip("/")
    if not path or path == "<front>":
        return ""
    path = re.sub(r"/+", "/", path)
    return path


def pretty_date(timestamp) -> str:
    try:
        return datetime.fromtimestamp(int(timestamp), UTC).strftime("%B %-d, %Y")
    except Exception:
        return ""


def strip_html(value: str) -> str:
    value = re.sub(r"<[^>]+>", " ", value or "")
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def excerpt(value: str, words: int = 36) -> str:
    text = strip_html(value)
    parts = text.split()
    if len(parts) <= words:
        return text
    return " ".join(parts[:words]) + "..."


class SiteBuilder:
    def __init__(self, data):
        self.data = data
        self.variables = {
            row["name"]: php_unserialize_string(row["value"])
            for row in data["variable"]
        }
        self.site_name = self.variables.get("site_name", "IndusTree")
        self.site_slogan = self.variables.get(
            "site_slogan", "ambient experimental industrial wave noise music from Nijmegen"
        )
        self.site_mail = self.variables.get("site_mail", "")

        self.nodes = {
            int(row["nid"]): row
            for row in data["node"]
            if int(row.get("status") or 0) == 1
        }
        self.revisions_by_vid = {
            int(row["vid"]): row
            for row in data["node_revisions"]
        }
        self.aliases = {
            row["src"]: clean_path(row["dst"])
            for row in data["url_alias"]
            if row["src"] and row["dst"] and not row["src"].endswith("/feed")
        }
        self.files_by_fid = {int(row["fid"]): row for row in data["files"]}
        self.audio_by_nid = {}
        for row in data["audio"]:
            nid = int(row["nid"])
            vid = int(row["vid"])
            if nid not in self.audio_by_nid or vid == int(self.nodes.get(nid, {}).get("vid", -1)):
                self.audio_by_nid[nid] = row

        self.audio_meta = defaultdict(dict)
        for row in data["audio_metadata"]:
            self.audio_meta[int(row["vid"])][row["tag"]] = row["value"]

        self.audio_fields_by_nid = {}
        for row in data["content_type_audio"]:
            self.audio_fields_by_nid[int(row["nid"])] = row

        self.primary_links = [
            row
            for row in data["menu_links"]
            if (
                row["menu_name"] == "primary-links"
                and int(row["hidden"]) == 0
                and int(row["depth"]) == 1
                and "%" not in row["link_path"]
            )
        ]
        self.primary_links.sort(key=lambda row: (int(row["weight"]), int(row["mlid"])))

    def node_path(self, nid: int) -> str:
        return self.aliases.get(f"node/{nid}") or f"node/{nid}"

    def page_dir(self, path: str) -> str:
        path = clean_path(path)
        return path

    def rel_url(self, from_path: str, target: str, directory: bool = True) -> str:
        from_dir = self.page_dir(from_path)
        target = clean_path(target)
        if directory:
            if target == "":
                target_ref = "."
            else:
                target_ref = target
        else:
            target_ref = target
        rel = posixpath.relpath(target_ref or ".", from_dir or ".")
        if rel == "." and directory:
            rel = "."
        if directory and rel != "." and not rel.endswith("/"):
            rel += "/"
        if directory and rel == ".":
            rel = "./"
        return quote(rel, safe="/#?=&.:@%+-_~")

    def resolve_drupal_path(self, raw_path: str, from_path: str, attr: str = "href") -> str:
        if not raw_path:
            return raw_path
        original_path = raw_path
        external_original = None
        if raw_path.startswith(("#", "mailto:", "tel:", "javascript:")):
            return raw_path
        parsed = urlparse(raw_path)
        if parsed.scheme in {"http", "https"}:
            host = parsed.netloc.lower()
            if host not in {"industree.org", "www.industree.org"}:
                return raw_path
            external_original = original_path
            raw_path = parsed.path
            suffix = ("?" + parsed.query if parsed.query else "") + ("#" + parsed.fragment if parsed.fragment else "")
        else:
            suffix = ""

        if raw_path.startswith("/"):
            path = clean_path(raw_path)
        else:
            path = clean_path(raw_path)

        if path in {"audio", "music", "contact", "archive", "lyrics"}:
            target = "audio" if path == "music" else path
        elif path.startswith("node/") and path in self.aliases:
            target = self.aliases[path]
        elif path in self.aliases.values():
            target = path
        elif path.startswith("files/"):
            return self.rel_url(from_path, path, directory=False) + suffix
        elif (OUT / path).exists():
            return self.rel_url(from_path, path, directory=False) + suffix
        elif external_original:
            return external_original
        else:
            target = path
        is_file = attr.lower() == "src" or bool(Path(target).suffix)
        return self.rel_url(from_path, target, directory=not is_file) + suffix

    def rewrite_body_links(self, body: str, from_path: str) -> str:
        def replace_attr(match):
            attr, quote_char, value = match.groups()
            return f'{attr}={quote_char}{self.resolve_drupal_path(value, from_path, attr)}{quote_char}'

        body = re.sub(r'\b(href|src)=([\'"])([^\'"]+)\2', replace_attr, body, flags=re.I)

        def replace_unquoted(match):
            attr, value = match.groups()
            return f'{attr}="{self.resolve_drupal_path(value, from_path, attr)}"'

        return re.sub(r"\b(href|src)=([^'\"\s>]+)", replace_unquoted, body, flags=re.I)

    def render_body(self, body: str, from_path: str) -> str:
        body = (body or "").replace("\r\n", "\n").replace("\r", "\n").strip()
        if not body:
            return ""
        body = self.rewrite_body_links(body, from_path)
        if re.search(r"</?(p|ul|ol|li|h[1-6]|blockquote|div|center|table|form|br|img|audio)\b", body, re.I):
            return body
        paragraphs = [part.strip() for part in re.split(r"\n\s*\n", body) if part.strip()]
        return "\n".join(f"<p>{part.replace(chr(10), '<br>')}</p>" for part in paragraphs)

    def nav_html(self, from_path: str) -> str:
        items = []
        fallback = [
            ("Welcome", ""),
            ("Music", "audio"),
            ("About", self.node_path(7) if 7 in self.nodes else "about"),
            ("Links", self.node_path(8) if 8 in self.nodes else "links"),
            ("CausaliDox", self.node_path(9) if 9 in self.nodes else "causalidox"),
            ("Buy CD's!", self.node_path(10) if 10 in self.nodes else "buy-cds"),
            ("Contact", "contact"),
        ]
        source = []
        for row in self.primary_links:
            target = clean_path(row["link_path"])
            if target == "<front>" or row["link_title"] == "Welcome":
                target = ""
            if target == "node/7" and 7 in self.nodes:
                target = self.node_path(7)
            elif target == "node/8" and 8 in self.nodes:
                target = self.node_path(8)
            elif target == "node/9" and 9 in self.nodes:
                target = self.node_path(9)
            elif target == "node/10" and 10 in self.nodes:
                target = self.node_path(10)
            elif target == "audio":
                target = "audio"
            source.append((row["link_title"], target))
        deduped = []
        seen = set()
        for title, target in source:
            key = (title.lower(), target)
            title_key = title.lower()
            if key in seen or title_key in seen:
                continue
            seen.add(key)
            seen.add(title_key)
            deduped.append((title, target))
        for title, target in deduped or fallback:
            href = self.rel_url(from_path, target, directory=True)
            items.append(f'<li><a href="{href}">{html.escape(title)}</a></li>')
        return "<ul>" + "\n".join(items) + "</ul>"

    def layout(self, title: str, body: str, from_path: str, *, description: str = "") -> str:
        css = self.rel_url(from_path, "assets/site.css", directory=False)
        logo = self.rel_url(from_path, "files/logo.gif", directory=False)
        page_title = self.site_name if title == self.site_name else f"{title} | {self.site_name}"
        description = description or self.site_slogan
        return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(page_title)}</title>
  <meta name="description" content="{html.escape(description)}">
  <link rel="stylesheet" href="{css}">
</head>
<body>
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="{self.rel_url(from_path, '', directory=True)}">
        <img src="{logo}" alt="{html.escape(self.site_name)}">
        <span>
          <strong>{html.escape(self.site_name)}</strong>
          <em>{html.escape(self.site_slogan)}</em>
        </span>
      </a>
      <nav class="primary-nav" aria-label="Primary navigation">
        {self.nav_html(from_path)}
      </nav>
    </div>
  </header>
  <main class="wrap">
    {body}
  </main>
  <footer class="site-footer">
    <div class="wrap">
      <p>IndusTree was an experimental noise music band from Nijmegen. Static archive generated from the Drupal 6 export.</p>
    </div>
  </footer>
</body>
</html>
"""

    def write_page(self, path: str, title: str, body: str, *, description: str = ""):
        path = clean_path(path)
        out_dir = OUT / path
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "index.html").write_text(
            self.layout(title, body, path, description=description),
            encoding="utf-8",
        )

    def write_file(self, path: str, content: str):
        target = OUT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

    def node_content_html(self, nid: int, path: str) -> str:
        node = self.nodes[nid]
        revision = self.revisions_by_vid.get(int(node["vid"]), {})
        body = revision.get("body", "")
        meta = pretty_date(node.get("created"))
        chunks = [
            f'<article class="node node-{html.escape(node["type"])}">',
            f"<h1>{html.escape(node['title'])}</h1>",
        ]
        if meta:
            chunks.append(f'<p class="meta">{meta}</p>')
        if node["type"] == "audio":
            chunks.append(self.audio_panel(nid, path))
        rendered = self.render_body(body, path)
        if rendered:
            chunks.append(f'<div class="content">{rendered}</div>')
        if node["type"] == "audio":
            fields = self.audio_fields_by_nid.get(nid) or {}
            lyrics_nid = fields.get("field_lyrics_link_nid")
            if lyrics_nid and int(lyrics_nid) in self.nodes:
                href = self.rel_url(path, self.node_path(int(lyrics_nid)), directory=True)
                chunks.append(f'<p class="related"><a href="{href}">Lyrics</a></p>')
        chunks.append("</article>")
        return "\n".join(chunks)

    def audio_panel(self, nid: int, from_path: str) -> str:
        row = self.audio_by_nid.get(nid)
        if not row:
            return '<div class="audio-panel"><p>No audio metadata found.</p></div>'
        vid = int(row["vid"])
        meta = self.audio_meta.get(vid, {})
        fid = int(row.get("fid") or 0)
        file_row = self.files_by_fid.get(fid, {})
        original_path = file_row.get("filepath", "")
        filename = file_row.get("filename") or Path(original_path).name
        expected = posixpath.join("files/audio", Path(original_path).name or filename)
        expected_local = OUT / expected
        details = []
        for key, label in [
            ("artist", "Artist"),
            ("album", "Album"),
            ("genre", "Genre"),
            ("year", "Year"),
        ]:
            if meta.get(key):
                details.append(f"<dt>{label}</dt><dd>{html.escape(str(meta[key]))}</dd>")
        if row.get("playtime"):
            details.append(f"<dt>Length</dt><dd>{html.escape(str(row['playtime']))}</dd>")
        body = ['<div class="audio-panel">']
        if expected_local.exists():
            src = self.rel_url(from_path, expected, directory=False)
            body.append(f'<audio controls preload="metadata" src="{src}"></audio>')
            body.append(f'<p><a class="button" href="{src}">Download audio</a></p>')
        elif filename:
            body.append(
                '<p class="missing-media">Audio file not included in this repository yet. '
                f'Expected static path: <code>{html.escape(expected)}</code>.</p>'
            )
        if details:
            body.append("<dl>" + "".join(details) + "</dl>")
        body.append("</div>")
        return "\n".join(body)

    def node_card(self, nid: int, from_path: str, *, compact: bool = False) -> str:
        node = self.nodes[nid]
        revision = self.revisions_by_vid.get(int(node["vid"]), {})
        href = self.rel_url(from_path, self.node_path(nid), directory=True)
        body = revision.get("teaser") or revision.get("body") or ""
        date = pretty_date(node.get("created"))
        type_label = node["type"].replace("_", " ").title()
        extra = ""
        if node["type"] == "audio":
            audio = self.audio_by_nid.get(nid) or {}
            meta = self.audio_meta.get(int(audio.get("vid") or 0), {})
            parts = [meta.get("artist"), meta.get("album"), audio.get("playtime")]
            extra = " / ".join(str(part) for part in parts if part)
        summary = "" if compact else f"<p>{html.escape(excerpt(body))}</p>"
        return f"""<article class="card">
  <h2><a href="{href}">{html.escape(node["title"])}</a></h2>
  <p class="meta">{html.escape(type_label)}{f" / {html.escape(date)}" if date else ""}{f" / {html.escape(extra)}" if extra else ""}</p>
  {summary}
</article>"""

    def build_node_pages(self):
        for nid in sorted(self.nodes):
            path = self.node_path(nid)
            node = self.nodes[nid]
            content = self.node_content_html(nid, path)
            revision = self.revisions_by_vid.get(int(node["vid"]), {})
            self.write_page(path, node["title"], content, description=excerpt(revision.get("body", "")))
            node_path = f"node/{nid}"
            if clean_path(path) != node_path:
                self.write_redirect(node_path, path)

    def write_redirect(self, path: str, target_path: str):
        path = clean_path(path)
        href = self.rel_url(path, target_path, directory=True)
        title = "Redirecting"
        body = f"""<section class="page">
  <h1>Redirecting</h1>
  <p><a href="{href}">Continue to the archived page.</a></p>
  <script>window.location.replace({href!r});</script>
</section>"""
        self.write_page(path, title, body)

    def build_home(self):
        welcome_nid = 3 if 3 in self.nodes else min(self.nodes)
        welcome = self.node_content_html(welcome_nid, "")
        featured_ids = [
            nid
            for nid, node in self.nodes.items()
            if int(node.get("promote") or 0) == 1 and nid != welcome_nid
        ]
        featured_ids.sort(key=lambda nid: int(self.nodes[nid]["created"]), reverse=True)
        cards = "\n".join(self.node_card(nid, "", compact=False) for nid in featured_ids[:8])
        body = welcome
        if cards:
            body += f'\n<section class="listing"><h1>Featured archive</h1>{cards}</section>'
        self.write_page("", self.site_name, body, description=self.site_slogan)

    def build_audio_index(self, path: str = "audio", title: str = "Music"):
        audio_ids = [
            nid for nid, node in self.nodes.items()
            if node["type"] == "audio"
        ]
        audio_ids.sort(key=lambda nid: (
            (self.audio_meta.get(int((self.audio_by_nid.get(nid) or {}).get("vid") or 0), {}).get("artist") or "").lower(),
            self.nodes[nid]["title"].lower(),
        ))
        cards = "\n".join(self.node_card(nid, path, compact=True) for nid in audio_ids)
        body = f"""<section class="page">
  <h1>{html.escape(title)}</h1>
  <p class="lede">A static archive of {len(audio_ids)} audio entries from the original Drupal site.</p>
  <div class="cards compact">{cards}</div>
</section>"""
        self.write_page(path, title, body)

    def build_lyrics_index(self):
        lyric_ids = [nid for nid, node in self.nodes.items() if node["type"] == "lyrics"]
        lyric_ids.sort(key=lambda nid: self.nodes[nid]["title"].lower())
        cards = "\n".join(self.node_card(nid, "lyrics", compact=True) for nid in lyric_ids)
        body = f"""<section class="page">
  <h1>Lyrics</h1>
  <div class="cards compact">{cards}</div>
</section>"""
        self.write_page("lyrics", "Lyrics", body)

    def build_archive(self):
        ids = sorted(self.nodes, key=lambda nid: int(self.nodes[nid]["created"]), reverse=True)
        cards = "\n".join(self.node_card(nid, "archive", compact=True) for nid in ids)
        body = f"""<section class="page">
  <h1>Archive</h1>
  <p class="lede">{len(ids)} published nodes converted from Drupal 6.</p>
  <div class="cards compact">{cards}</div>
</section>"""
        self.write_page("archive", "Archive", body)

    def build_contact(self):
        target = "https://marcusmoonen.com/contact/"
        content = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0; url={target}">
  <link rel="canonical" href="{target}">
  <title>Contact | IndusTree</title>
</head>
<body>
  <p>Redirecting to <a href="{target}">marcusmoonen.com/contact/</a>.</p>
  <script>window.location.replace("{target}");</script>
</body>
</html>
"""
        self.write_file("contact/index.html", content)

    def build_404(self):
        body = """<section class="page">
  <h1>Page not found</h1>
  <p>This static archive may have a different path than the old Drupal site.</p>
  <p><a href="./">Return to the archive home</a></p>
</section>"""
        self.write_file("404.html", self.layout("Page not found", body, ""))

    def build_sitemap(self):
        urls = [""] + [self.node_path(nid) for nid in self.nodes] + ["audio", "music", "lyrics", "archive", "contact"]
        entries = "\n".join(
            f"  <url><loc>/{html.escape(clean_path(url))}</loc></url>" for url in sorted(set(urls))
        )
        self.write_file("sitemap.xml", f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{entries}\n</urlset>\n')

    def copy_assets(self):
        assets = OUT / "assets"
        assets.mkdir(parents=True, exist_ok=True)
        files_out = OUT / "files"
        if files_out.exists():
            shutil.rmtree(files_out)
        shutil.copytree(ROOT / "files", files_out, ignore=shutil.ignore_patterns(".htaccess"))
        bobimages = ROOT / "bobimages"
        if bobimages.exists():
            bobimages_out = OUT / "bobimages"
            if bobimages_out.exists():
                shutil.rmtree(bobimages_out)
            shutil.copytree(bobimages, bobimages_out)
        (assets / "site.css").write_text(STYLE_CSS, encoding="utf-8")
        (OUT / ".nojekyll").write_text("", encoding="utf-8")

    def build(self):
        if OUT.exists():
            shutil.rmtree(OUT)
        OUT.mkdir(parents=True)
        self.copy_assets()
        self.build_node_pages()
        self.build_home()
        self.build_audio_index("audio", "Music")
        self.build_audio_index("music", "Music")
        self.build_lyrics_index()
        self.build_archive()
        self.build_contact()
        self.build_404()
        self.build_sitemap()


STYLE_CSS = """
:root {
  --paper: #f4f0e8;
  --ink: #161616;
  --muted: #676158;
  --line: #d5ccbf;
  --accent: #b53427;
  --accent-dark: #70221c;
  --panel: #fffaf0;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  color: var(--ink);
  background: #151515 url("../files/viz/backtop6.jpg") top center fixed;
  font: 16px/1.55 Georgia, "Times New Roman", serif;
}

a { color: var(--accent-dark); }
a:hover { color: var(--accent); }

.wrap {
  width: min(1080px, calc(100% - 32px));
  margin: 0 auto;
}

.site-header {
  background: rgba(244, 240, 232, 0.96);
  border-bottom: 1px solid var(--line);
}

.header-inner {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto;
  gap: 24px;
  align-items: center;
  padding: 18px 0;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  color: var(--ink);
  text-decoration: none;
}

.brand img {
  width: 80px;
  height: auto;
}

.brand strong {
  display: block;
  font-size: 32px;
  line-height: 1;
}

.brand em {
  display: block;
  color: var(--muted);
  font-size: 14px;
  font-style: normal;
}

.primary-nav ul {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  margin: 0;
  padding: 0;
  list-style: none;
}

.primary-nav a {
  display: block;
  padding: 7px 10px;
  border: 1px solid var(--line);
  background: #fffdf7;
  text-decoration: none;
}

main.wrap {
  margin-top: 28px;
  margin-bottom: 28px;
  padding: 28px;
  background: rgba(244, 240, 232, 0.96);
  border: 1px solid var(--line);
}

h1, h2, h3 {
  line-height: 1.15;
  margin: 0 0 16px;
}

h1 { font-size: 36px; }
h2 { font-size: 24px; }

.meta, .lede, .missing-media, .related {
  color: var(--muted);
}

.content {
  max-width: 78ch;
}

.content img {
  max-width: 100%;
  height: auto;
}

.listing {
  margin-top: 36px;
  padding-top: 28px;
  border-top: 1px solid var(--line);
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.cards.compact {
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

.card {
  min-width: 0;
  padding: 16px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
}

.card h2 {
  font-size: 20px;
  overflow-wrap: anywhere;
}

.card p {
  margin-bottom: 0;
}

.audio-panel {
  max-width: 760px;
  margin: 0 0 24px;
  padding: 16px;
  background: #fffdf7;
  border: 1px solid var(--line);
}

.audio-panel audio {
  width: 100%;
}

.audio-panel dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 12px 0 0;
}

.audio-panel dt {
  color: var(--muted);
}

.audio-panel dd {
  margin: 0;
}

.button {
  display: inline-block;
  padding: 8px 12px;
  color: #fff;
  background: var(--accent-dark);
  text-decoration: none;
}

.site-footer {
  padding: 18px 0 28px;
  color: #f4f0e8;
}

.site-footer p {
  margin: 0;
}

@media (max-width: 760px) {
  .header-inner {
    grid-template-columns: 1fr;
  }

  .primary-nav ul {
    justify-content: flex-start;
  }

  main.wrap {
    padding: 20px;
  }

  h1 {
    font-size: 30px;
  }
}
"""


def main() -> int:
    if not SQL_DUMP.exists():
        print(f"Missing {SQL_DUMP}", file=sys.stderr)
        return 1
    data = read_tables()
    SiteBuilder(data).build()
    print(f"Built static site in {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
