#!/usr/bin/env python3
"""Build a DRY static app version of the Drupal 6 site."""

from __future__ import annotations

import gzip
import html
import json
import os
import posixpath
import re
import shutil
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote, urlparse


ROOT = Path(__file__).resolve().parents[1]
SQL_DUMP = ROOT / "industree.sql.gz"
OUT = ROOT / "docs"
MEDIA_MANIFEST = ROOT / "media" / "audio_manifest.json"
DEFAULT_MEDIA_BASE_URL = "https://audio.industree.org"
CUSTOM_DOMAIN = "industree.org"
CONTACT_URL = "https://marcusmoonen.com/contact/"
TARGET_TABLES = {
    "audio",
    "audio_metadata",
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


def load_audio_manifest(path: Path = MEDIA_MANIFEST):
    if not path.exists():
        return {}, ""
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    media_base_url = payload.get("media_base_url", "") if isinstance(payload, dict) else ""
    entries = payload.get("tracks", payload) if isinstance(payload, dict) else payload
    manifest = {}
    for entry in entries:
        if isinstance(entry, dict) and entry.get("node_id"):
            manifest[int(entry["node_id"])] = entry
    return manifest, media_base_url


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
    return re.sub(r"/+", "/", path)


def app_url(path: str) -> str:
    path = clean_path(path)
    if not path:
        return "/"
    return "/" + quote(path, safe="/#?=&.:@%+-_~") + "/"


def asset_url(path: str) -> str:
    return "/" + quote(clean_path(path), safe="/#?=&.:@%+-_~")


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
            "site_slogan",
            "ambient experimental industrial wave noise music from Nijmegen",
        )
        self.audio_manifest, manifest_media_base_url = load_audio_manifest()
        self.media_base_url = os.environ.get(
            "MEDIA_BASE_URL", manifest_media_base_url or DEFAULT_MEDIA_BASE_URL
        ).strip().rstrip("/")

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
            clean_path(row["src"]): clean_path(row["dst"])
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

        self.audio_fields_by_nid = {
            int(row["nid"]): row for row in data["content_type_audio"]
        }

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

    def media_url(self, server_path: str) -> str:
        path = (server_path or "").replace("\\", "/").lstrip("/")
        return f"{self.media_base_url}/{quote(path, safe='/._-~')}"

    def resolve_drupal_path(self, raw_path: str, attr: str = "href") -> str:
        if not raw_path:
            return raw_path
        if raw_path.startswith(("#", "mailto:", "tel:", "javascript:")):
            return raw_path

        original_path = raw_path
        external_original = None
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

        path = clean_path(raw_path)
        if path in {"audio", "music", "contact", "archive", "lyrics"}:
            target = "audio" if path == "music" else path
        elif path.startswith("node/") and path in self.aliases:
            target = self.aliases[path]
        elif path in self.aliases.values():
            target = path
        elif path.startswith(("files/", "bobimages/")):
            return asset_url(path) + suffix
        elif external_original:
            return external_original
        else:
            target = path

        is_file = attr.lower() == "src" or bool(Path(target).suffix)
        return (asset_url(target) if is_file else app_url(target)) + suffix

    def rewrite_body_links(self, body: str) -> str:
        def replace_attr(match):
            attr, quote_char, value = match.groups()
            resolved = self.resolve_drupal_path(value, attr)
            return f'{attr}={quote_char}{html.escape(resolved, quote=True)}{quote_char}'

        body = re.sub(r'\b(href|src)=([\'"])([^\'"]+)\2', replace_attr, body, flags=re.I)

        def replace_unquoted(match):
            attr, value = match.groups()
            resolved = self.resolve_drupal_path(value, attr)
            return f'{attr}="{html.escape(resolved, quote=True)}"'

        return re.sub(r"\b(href|src)=([^'\"\s>]+)", replace_unquoted, body, flags=re.I)

    def render_body(self, body: str) -> str:
        body = (body or "").replace("\r\n", "\n").replace("\r", "\n").strip()
        if not body:
            return ""
        body = self.rewrite_body_links(body)
        if re.search(r"</?(p|ul|ol|li|h[1-6]|blockquote|div|center|table|form|br|img|audio)\b", body, re.I):
            return body
        paragraphs = [part.strip() for part in re.split(r"\n\s*\n", body) if part.strip()]
        return "\n".join(f"<p>{part.replace(chr(10), '<br>')}</p>" for part in paragraphs)

    def nav_items(self):
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
            elif target.startswith("node/") and target in self.aliases:
                target = self.aliases[target]
            elif target == "music":
                target = "audio"
            source.append((row["link_title"], target))

        deduped = []
        seen = set()
        for title, target in source or fallback:
            key = (title.lower(), target)
            title_key = title.lower()
            if key in seen or title_key in seen:
                continue
            seen.add(key)
            seen.add(title_key)
            deduped.append({"title": title, "path": clean_path(target), "href": app_url(target)})
        return deduped

    def audio_details(self, nid: int):
        row = self.audio_by_nid.get(nid)
        if not row:
            return None

        vid = int(row["vid"])
        meta = self.audio_meta.get(vid, {})
        fid = int(row.get("fid") or 0)
        file_row = self.files_by_fid.get(fid, {})
        original_path = file_row.get("filepath", "")
        filename = file_row.get("filename") or Path(original_path).name
        expected = posixpath.join("files/audio", Path(original_path).name or filename)
        manifest_entry = self.audio_manifest.get(nid)

        details = []
        for key, label in [
            ("artist", "Artist"),
            ("album", "Album"),
            ("genre", "Genre"),
            ("year", "Year"),
        ]:
            if meta.get(key):
                details.append({"label": label, "value": str(meta[key])})
        if row.get("playtime"):
            details.append({"label": "Length", "value": str(row["playtime"])})

        panel = {
            "details": details,
            "expectedPath": expected if filename else "",
            "source": "",
            "download": "",
            "mediaNote": "",
            "missingMessage": "",
        }
        if manifest_entry:
            media_format = (manifest_entry.get("format") or "").upper()
            match_type_title = (manifest_entry.get("match_type") or "manual").replace("_", " ").title()
            match_type = (manifest_entry.get("match_type") or "manual").lower()
            if media_format:
                details.append({"label": "Restored format", "value": media_format})
            details.append({"label": "Restored match", "value": match_type_title})
            if self.media_base_url:
                src = self.media_url(manifest_entry.get("server_path", ""))
                panel["source"] = src
                panel["download"] = src
                if media_format != "MP3" or match_type != "exact":
                    panel["mediaNote"] = f"Restored as {media_format or 'audio'} from the external audio archive."
            else:
                server_path = manifest_entry.get("server_path", "")
                panel["missingMessage"] = (
                    "Audio recovered in media/audio_manifest.json. "
                    f"Set MEDIA_BASE_URL to publish external audio from {server_path}."
                )
        elif filename and (ROOT / expected).exists():
            panel["source"] = asset_url(expected)
            panel["download"] = asset_url(expected)
        elif filename:
            panel["missingMessage"] = f"Audio file not included in this repository yet. Expected static path: {expected}."

        return panel

    def node_extra(self, nid: int) -> str:
        node = self.nodes[nid]
        if node["type"] != "audio":
            return ""
        audio = self.audio_by_nid.get(nid) or {}
        meta = self.audio_meta.get(int(audio.get("vid") or 0), {})
        parts = [meta.get("artist"), meta.get("album"), audio.get("playtime")]
        return " / ".join(str(part) for part in parts if part)

    def node_payload(self, nid: int):
        node = self.nodes[nid]
        revision = self.revisions_by_vid.get(int(node["vid"]), {})
        body = revision.get("body", "")
        path = self.node_path(nid)
        payload = {
            "id": nid,
            "type": node["type"],
            "typeLabel": node["type"].replace("_", " ").title(),
            "title": node["title"],
            "path": path,
            "href": app_url(path),
            "created": int(node.get("created") or 0),
            "date": pretty_date(node.get("created")),
            "promoted": int(node.get("promote") or 0) == 1,
            "bodyHtml": self.render_body(body),
            "excerpt": excerpt(revision.get("teaser") or body),
            "extra": self.node_extra(nid),
            "audio": None,
            "lyricsPath": "",
        }
        if node["type"] == "audio":
            payload["audio"] = self.audio_details(nid)
            fields = self.audio_fields_by_nid.get(nid) or {}
            lyrics_nid = fields.get("field_lyrics_link_nid")
            if lyrics_nid and int(lyrics_nid) in self.nodes:
                payload["lyricsPath"] = self.node_path(int(lyrics_nid))
        return payload

    def app_data(self):
        welcome_nid = 3 if 3 in self.nodes else min(self.nodes)
        featured_ids = [
            nid
            for nid, node in self.nodes.items()
            if int(node.get("promote") or 0) == 1 and nid != welcome_nid
        ]
        featured_ids.sort(key=lambda nid: int(self.nodes[nid]["created"]), reverse=True)

        audio_ids = [nid for nid, node in self.nodes.items() if node["type"] == "audio"]
        audio_ids.sort(key=lambda nid: (
            (self.audio_meta.get(int((self.audio_by_nid.get(nid) or {}).get("vid") or 0), {}).get("artist") or "").lower(),
            self.nodes[nid]["title"].lower(),
        ))

        lyric_ids = [nid for nid, node in self.nodes.items() if node["type"] == "lyrics"]
        lyric_ids.sort(key=lambda nid: self.nodes[nid]["title"].lower())
        archive_ids = sorted(self.nodes, key=lambda nid: int(self.nodes[nid]["created"]), reverse=True)

        aliases = {clean_path(src): clean_path(dst) for src, dst in self.aliases.items()}
        aliases.update({"music": "audio"})
        path_to_node = {}
        for nid in self.nodes:
            node_path = self.node_path(nid)
            path_to_node[node_path] = nid
            aliases[f"node/{nid}"] = node_path

        return {
            "site": {
                "name": self.site_name,
                "slogan": self.site_slogan,
                "description": self.site_slogan,
                "logo": "/files/logo.gif",
                "footer": (
                    "IndusTree was an experimental noise music band from Nijmegen. "
                    "Static archive generated from the Drupal 6 export."
                ),
                "repositoryUrl": "https://github.com/guaka/industree.org",
                "contactUrl": CONTACT_URL,
                "mediaBaseUrl": self.media_base_url,
            },
            "nav": self.nav_items(),
            "aliases": aliases,
            "pathToNode": path_to_node,
            "nodes": {str(nid): self.node_payload(nid) for nid in sorted(self.nodes)},
            "lists": {
                "home": {
                    "welcomeId": welcome_nid,
                    "featuredIds": featured_ids[:8],
                },
                "audio": audio_ids,
                "lyrics": lyric_ids,
                "archive": archive_ids,
            },
        }

    def write_file(self, path: str, content: str):
        target = OUT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

    def write_json(self, path: str, payload):
        target = OUT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def copy_assets(self):
        assets = OUT / "assets"
        assets.mkdir(parents=True, exist_ok=True)

        files_out = OUT / "files"
        shutil.copytree(ROOT / "files", files_out, ignore=shutil.ignore_patterns(".htaccess"))

        bobimages = ROOT / "bobimages"
        if bobimages.exists():
            shutil.copytree(bobimages, OUT / "bobimages")

        self.write_file("assets/site.css", STYLE_CSS)
        self.write_file("assets/index.js", INDEX_JS)
        self.write_file(".nojekyll", "")
        self.write_file("CNAME", CUSTOM_DOMAIN + "\n")

    def build_sitemap(self):
        urls = ["", "audio", "music", "lyrics", "archive", "contact"]
        urls.extend(self.node_path(nid) for nid in self.nodes)
        urls.extend(f"node/{nid}" for nid in self.nodes)
        entries = "\n".join(
            f"  <url><loc>/{html.escape(clean_path(url))}</loc></url>"
            for url in sorted(set(urls))
        )
        self.write_file(
            "sitemap.xml",
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            f"{entries}\n"
            "</urlset>\n",
        )

    def build(self):
        if OUT.exists():
            shutil.rmtree(OUT)
        OUT.mkdir(parents=True)
        self.copy_assets()
        self.write_json("assets/site-data.json", self.app_data())
        self.write_file("index.html", APP_SHELL)
        self.write_file("404.html", APP_SHELL)
        self.build_sitemap()


APP_SHELL = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>IndusTree</title>
  <meta name="description" content="ambient experimental industrial wave noise music from Nijmegen">
  <link rel="stylesheet" href="/assets/site.css">
</head>
<body>
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="/">
        <img src="/files/logo.gif" alt="IndusTree">
        <span>
          <strong>IndusTree</strong>
          <em>ambient experimental industrial wave noise music from Nijmegen</em>
        </span>
      </a>
      <nav class="primary-nav" aria-label="Primary navigation" data-nav></nav>
    </div>
  </header>
  <main class="wrap" id="app">
    <section class="page app-loading">
      <h1>IndusTree</h1>
      <p>Loading archive...</p>
      <noscript>
        <p>This static archive needs JavaScript to render its pages.</p>
      </noscript>
    </section>
  </main>
  <footer class="site-footer">
    <div class="wrap">
      <p><span data-footer>IndusTree was an experimental noise music band from Nijmegen. Static archive generated from the Drupal 6 export.</span> <a href="https://github.com/guaka/industree.org">View the repository</a>.</p>
    </div>
  </footer>
  <script src="/assets/index.js" defer></script>
</body>
</html>
"""


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

.primary-nav a[aria-current="page"] {
  color: #fff;
  background: var(--accent-dark);
  border-color: var(--accent-dark);
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

.meta, .lede, .missing-media, .media-note, .related {
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


INDEX_JS = r"""
(() => {
  const scriptUrl = new URL(document.currentScript.src);
  const assetBase = new URL(".", scriptUrl);
  const dataUrl = new URL("site-data.json", assetBase);
  const app = document.getElementById("app");
  const nav = document.querySelector("[data-nav]");
  const footer = document.querySelector("[data-footer]");
  let archive;

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  const decodePath = (path) => {
    try {
      return decodeURI(path);
    } catch {
      return path;
    }
  };

  const normalizePath = (path) => decodePath(path || "/")
    .replace(/\/index\.html$/, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/");

  const routeHref = (path) => {
    const clean = normalizePath(path);
    return clean ? `/${clean}/` : "/";
  };

  const canonicalPath = (path) => {
    const clean = normalizePath(path);
    return archive.aliases[clean] || clean;
  };

  const titleFor = (title) => {
    if (!title || title === archive.site.name) return archive.site.name;
    return `${title} | ${archive.site.name}`;
  };

  const setMeta = (title, description = archive.site.description) => {
    document.title = titleFor(title);
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", description || archive.site.description);
  };

  const cardHtml = (node, compact = false) => {
    const extra = node.extra ? ` / ${escapeHtml(node.extra)}` : "";
    const date = node.date ? ` / ${escapeHtml(node.date)}` : "";
    const summary = compact || !node.excerpt ? "" : `<p>${escapeHtml(node.excerpt)}</p>`;
    return `<article class="card">
  <h2><a href="${routeHref(node.path)}">${escapeHtml(node.title)}</a></h2>
  <p class="meta">${escapeHtml(node.typeLabel)}${date}${extra}</p>
  ${summary}
</article>`;
  };

  const audioPanelHtml = (node) => {
    const audio = node.audio;
    if (!audio) {
      return '<div class="audio-panel"><p>No audio metadata found.</p></div>';
    }

    const chunks = ['<div class="audio-panel">'];
    if (audio.source) {
      chunks.push(`<audio controls preload="metadata" src="${escapeHtml(audio.source)}"></audio>`);
      chunks.push(`<p><a class="button" href="${escapeHtml(audio.download || audio.source)}">Download audio</a></p>`);
      if (audio.mediaNote) {
        chunks.push(`<p class="media-note">${escapeHtml(audio.mediaNote)}</p>`);
      }
    } else if (audio.missingMessage) {
      chunks.push(`<p class="missing-media">${escapeHtml(audio.missingMessage)}</p>`);
    }

    if (audio.details?.length) {
      chunks.push("<dl>");
      for (const detail of audio.details) {
        chunks.push(`<dt>${escapeHtml(detail.label)}</dt><dd>${escapeHtml(detail.value)}</dd>`);
      }
      chunks.push("</dl>");
    }
    chunks.push("</div>");
    return chunks.join("");
  };

  const nodeHtml = (node) => {
    const chunks = [`<article class="node node-${escapeHtml(node.type)}">`, `<h1>${escapeHtml(node.title)}</h1>`];
    if (node.date) chunks.push(`<p class="meta">${escapeHtml(node.date)}</p>`);
    if (node.type === "audio") chunks.push(audioPanelHtml(node));
    if (node.bodyHtml) chunks.push(`<div class="content">${node.bodyHtml}</div>`);
    if (node.lyricsPath) {
      chunks.push(`<p class="related"><a href="${routeHref(node.lyricsPath)}">Lyrics</a></p>`);
    }
    chunks.push("</article>");
    return chunks.join("\n");
  };

  const renderHome = () => {
    const home = archive.lists.home;
    const welcome = archive.nodes[String(home.welcomeId)];
    const featured = home.featuredIds
      .map((id) => archive.nodes[String(id)])
      .filter(Boolean)
      .map((node) => cardHtml(node))
      .join("\n");
    setMeta(archive.site.name, archive.site.description);
    app.innerHTML = nodeHtml(welcome) + (featured
      ? `\n<section class="listing"><h1>Featured archive</h1>${featured}</section>`
      : "");
  };

  const renderList = (key, title, lede = "") => {
    const nodes = (archive.lists[key] || [])
      .map((id) => archive.nodes[String(id)])
      .filter(Boolean);
    setMeta(title);
    app.innerHTML = `<section class="page">
  <h1>${escapeHtml(title)}</h1>
  ${lede ? `<p class="lede">${escapeHtml(lede.replace("{count}", nodes.length))}</p>` : ""}
  <div class="cards compact">${nodes.map((node) => cardHtml(node, true)).join("\n")}</div>
</section>`;
  };

  const renderContact = () => {
    setMeta("Contact");
    app.innerHTML = `<section class="page">
  <h1>Contact</h1>
  <p class="lede">Contact for this archive now lives at <a href="${escapeHtml(archive.site.contactUrl)}">marcusmoonen.com/contact/</a>.</p>
</section>`;
  };

  const renderNotFound = () => {
    setMeta("Page not found");
    app.innerHTML = `<section class="page">
  <h1>Page not found</h1>
  <p>This static archive may have a different path than the old Drupal site.</p>
  <p><a href="/">Return to the archive home</a></p>
</section>`;
  };

  const renderRoute = () => {
    const path = canonicalPath(location.pathname);
    renderNav(path);

    if (!path) return renderHome();
    if (path === "audio" || path === "music") {
      return renderList("audio", "Music", "A static archive of {count} audio entries from the original Drupal site.");
    }
    if (path === "lyrics") return renderList("lyrics", "Lyrics");
    if (path === "archive") {
      return renderList("archive", "Archive", "{count} published nodes converted from Drupal 6.");
    }
    if (path === "contact") return renderContact();

    const nodeId = archive.pathToNode[path];
    if (nodeId) {
      const node = archive.nodes[String(nodeId)];
      setMeta(node.title, node.excerpt);
      app.innerHTML = nodeHtml(node);
      return;
    }
    renderNotFound();
  };

  const renderNav = (currentPath = canonicalPath(location.pathname)) => {
    if (!nav) return;
    const items = archive.nav.map((item) => {
      const itemPath = canonicalPath(item.path);
      const active = itemPath === currentPath || (!itemPath && !currentPath);
      return `<li><a href="${routeHref(item.path)}"${active ? ' aria-current="page"' : ""}>${escapeHtml(item.title)}</a></li>`;
    });
    nav.innerHTML = `<ul>${items.join("\n")}</ul>`;
  };

  const handleClick = (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a[href]");
    if (!link || link.target || link.hasAttribute("download")) return;

    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/files/") || url.pathname.startsWith("/bobimages/")) return;
    if (/\.[a-z0-9]{2,5}$/i.test(url.pathname) && !url.pathname.endsWith("/index.html")) return;

    event.preventDefault();
    history.pushState({}, "", url.pathname + url.search + url.hash);
    renderRoute();
    if (!url.hash) window.scrollTo({ top: 0, behavior: "instant" });
  };

  fetch(dataUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Failed to load ${dataUrl.pathname}`);
      return response.json();
    })
    .then((data) => {
      archive = data;
      document.querySelector(".brand")?.setAttribute("href", "/");
      document.querySelector(".brand img")?.setAttribute("src", archive.site.logo);
      document.querySelector(".brand img")?.setAttribute("alt", archive.site.name);
      const brandName = document.querySelector(".brand strong");
      const brandSlogan = document.querySelector(".brand em");
      if (brandName) brandName.textContent = archive.site.name;
      if (brandSlogan) brandSlogan.textContent = archive.site.slogan;
      if (footer) footer.textContent = archive.site.footer;
      renderRoute();
      document.addEventListener("click", handleClick);
      window.addEventListener("popstate", renderRoute);
    })
    .catch((error) => {
      console.error(error);
      app.innerHTML = `<section class="page">
  <h1>Archive unavailable</h1>
  <p>The site data could not be loaded.</p>
</section>`;
    });
})();
"""


def main() -> int:
    if not SQL_DUMP.exists():
        print(f"Missing {SQL_DUMP}", file=sys.stderr)
        return 1
    data = read_tables()
    SiteBuilder(data).build()
    print(f"Built static app in {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
