
(() => {
  const scriptUrl = new URL(document.currentScript.src);
  const assetBase = new URL(".", scriptUrl);
  const dataUrl = new URL("site-data.json?v=4", assetBase);
  const app = document.getElementById("app");
  const nav = document.querySelector("[data-nav]");
  const footer = document.querySelector("[data-footer]");
  let playerHost;
  let persistentPlayer = {
    kind: "",
    key: "",
  };
  let archive;
  const musicState = {
    artist: "all",
    query: "",
    status: "all",
    currentId: null,
    currentKind: "",
    currentTarget: "",
  };
  const DEFAULT_ARTIST = "IndusTree";
  const IMPULSE_ARTIST = "Impulse Tracker";
  const MUSIC_STATUSES = ["all", "audio", "it", "lyrics"];
  const MUSIC_STATUS_FILTERS = new Set(MUSIC_STATUSES);
  const MUSIC_STATUS_ALIASES = {
    impulse: "it",
  };
  const MUSIC_PAGE_PATHS = new Set(["audio", "music", "lyrics", "impulse"]);
  const STATIC_PATH_PREFIXES = ["/assets/", "/files/", "/bobimages/"];
  const GENERIC_ALBUM_TITLES = new Set(["", "album"]);
  const ALBUM_ALIASES = {};
  const ALBUM_TRACKLISTS = {
    "causalidox:promo-electronic-music-for-your-mind": [
      "brightideasdarkly",
      "inhindsight",
      "darkcountryblues",
      "limitedassumption",
      "secondorgasm",
      "cottonhead",
    ],
    "causalidox:autumnland": [
      "duskapproaches",
      "metalforestwhispers",
      "thetruedissolve",
    ],
    "industree:the-metro-mind-ep-1997": [
      "metromind",
      "noisy2",
      "leftalone",
    ],
  };
  const ALBUM_EXCLUSIONS = new Set([
    "industree:chinchilla-recordings-of-shit",
  ]);

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

  const currentRoutePath = () => {
    if (location.hash.startsWith("#/")) {
      return location.hash.slice(1);
    }
    return location.pathname;
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

  const nodeById = (id) => archive.nodes[String(id)];

  const nodesForIds = (ids = []) => ids
    .map(nodeById)
    .filter(Boolean);

  const nodesForList = (key) => nodesForIds(archive.lists[key] || []);

  const countLabel = (label, count) => `${label} (${count})`;

  const selectedAttr = (condition, name = "selected") => (condition ? ` ${name}` : "");

  const isMusicPagePath = (path) => MUSIC_PAGE_PATHS.has(path);

  const slugFor = (value) => String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const defaultMusicStatusForPath = (path) => {
    if (path === "impulse") return "it";
    if (path === "lyrics") return "lyrics";
    return "all";
  };

  const isStaticAssetPath = (pathname) =>
    STATIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  const musicHashFor = (status = "all", artist = "all") => {
    const cleanStatus = MUSIC_STATUS_FILTERS.has(status) ? status : "all";
    const cleanArtist = artist && artist !== "all" ? artist : "";
    const parts = [];
    if (cleanStatus !== "all") parts.push(cleanStatus);
    if (cleanArtist) parts.push(cleanArtist);
    return parts.join("/");
  };

  const musicFilterHref = (status = musicState.status, artist = musicState.artist) => {
    const hash = musicHashFor(status, artist);
    return `${routeHref("audio")}${hash ? `#${hash}` : ""}`;
  };

  const optionHtml = ([label, key, count], selected) =>
    `<option value="${escapeHtml(key)}"${selectedAttr(selected === key)}>${escapeHtml(countLabel(label, count))}</option>`;

  const musicFilterHtml = ([label, key, count]) =>
    `<a class="music-filter" href="${musicFilterHref(key, musicState.artist)}" data-music-status="${escapeHtml(key)}" aria-pressed="${musicState.status === key}">${escapeHtml(countLabel(label, count))}</a>`;

  const slugLabel = (value) => String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  const artistKeyFor = (artist) => String(artist || DEFAULT_ARTIST)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "industree";

  const musicFilterStateFromHash = (defaultStatus = "all") => {
    const defaultState = {
      artist: "all",
      status: MUSIC_STATUS_FILTERS.has(defaultStatus) ? defaultStatus : "all",
    };
    if (!location.hash || location.hash.startsWith("#/")) return defaultState;

    let hash = location.hash.slice(1);
    try {
      hash = decodeURIComponent(hash);
    } catch {
      return defaultState;
    }

    const artistKeys = new Set((archive.musicCatalog || []).map((item) => item.artistKey));
    return hash
      .toLowerCase()
      .replace(/^\/+|\/+$/g, "")
      .split(/[\/,+&\s]+/)
      .filter(Boolean)
      .reduce((state, token) => {
        const status = MUSIC_STATUS_ALIASES[token] || token;
        if (MUSIC_STATUS_FILTERS.has(status)) {
          state.status = status;
          if (status === "all") state.artist = "all";
        } else if (artistKeys.has(token)) {
          state.artist = token;
        }
        return state;
      }, defaultState);
  };

  const applyMusicFilterHash = (defaultStatus = "all") => {
    const state = musicFilterStateFromHash(defaultStatus);
    musicState.status = state.status;
    musicState.artist = state.artist;
  };

  const impulseFileByName = (name) => (archive.impulse?.files || [])
    .find((file) => file.name === name);

  const linkedMediaFor = (path) => archive.songMedia?.[path] || {};

  const searchTextFor = (...values) => values
    .flat()
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const VERSION_WORDS = new Set([
    "a",
    "an",
    "alternate",
    "at",
    "bass",
    "demo",
    "draft",
    "edit",
    "excerpt",
    "first",
    "live",
    "mix",
    "new",
    "on",
    "part",
    "raw",
    "remake",
    "remix",
    "rough",
    "special",
    "studio",
    "take",
    "the",
    "version",
    "with",
  ]);

  const splitWords = (value) => String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/^\s*\(?\d{4}[-./]\d{1,2}[-./]\d{1,2}[a-z]?\)?\s*/, " ")
    .replace(/^\s*\d+\s*[-._]+\s*/, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ({
      ii: "2",
      iii: "3",
      iv: "4",
      vi: "6",
      vii: "7",
      viii: "8",
      ix: "9",
    })[word] || word);

  const titleWords = (value) => {
    let clean = String(value || "");
    const beforeParen = clean.split("(")[0].trim();
    if (beforeParen.length > 2) clean = beforeParen;
    clean = clean.replace(/\bby\b.*$/i, "");
    return splitWords(clean)
      .filter((word) => !VERSION_WORDS.has(word));
  };

  const compactWords = (words) => words.join("");

  const titleKeyFor = (value, fallback = "") => {
    const compact = compactWords(titleWords(value));
    return compact.length > 2 ? compact : compactWords(splitWords(fallback));
  };

  const fileKeyFor = (name) => {
    const words = splitWords(name)
      .filter((word) => !VERSION_WORDS.has(word));
    if (words.length > 1 && /^[a-z0-9]$/.test(words[0])) words.shift();
    const originalCompact = compactWords(words);
    const startsWithDigit = /^\d/.test(originalCompact);
    let compact = originalCompact.replace(/^\d+/, "");
    if (!startsWithDigit && words.length === 1 && /^[a-z][a-z0-9]{4,}$/.test(compact)) {
      compact = compact.replace(/^[a-z](?=[a-z]{4,})/, "");
    }
    return compact || compactWords(splitWords(name));
  };

  const similarityScore = (a, b) => {
    a = String(a || "");
    b = String(b || "");
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    const current = Array.from({ length: b.length + 1 }, () => 0);
    for (let i = 1; i <= a.length; i += 1) {
      current[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        current[j] = Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + cost,
        );
      }
      for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
    }
    return 1 - (previous[b.length] / Math.max(a.length, b.length));
  };

  const itFilesFor = (linked = {}) => (linked.itFiles || [])
    .map(impulseFileByName)
    .filter(Boolean);

  const uniqueBy = (items, keyFor) => {
    const seen = new Set();
    return items.filter((item) => {
      const key = keyFor(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const rememberItFiles = (files, usedItFiles) => {
    for (const file of files) usedItFiles.add(file.name);
  };

  const prepareMusicCatalog = () => {
    const groups = new Map();
    const byPath = {};
    const byId = {};
    const usedLyrics = new Set();
    const usedItFiles = new Set();
    const lyricsByPath = new Map(nodesForList("lyrics").map((node) => [node.path, node]));
    const audioNodes = nodesForList("audio");

    const groupKeyFor = (artistKey, title, fallbackPath, linked = {}) => {
      if (linked.excludeGroup || linked.separate) {
        return `${artistKeyFor(artistKey || DEFAULT_ARTIST)}:${normalizePath(fallbackPath).replace(/[^a-z0-9]+/gi, "")}`;
      }
      const manualKey = linked.groupKey || linked.songKey || "";
      const key = manualKey ? titleKeyFor(manualKey, fallbackPath) : titleKeyFor(title, fallbackPath);
      return `${artistKeyFor(artistKey || DEFAULT_ARTIST)}:${key || normalizePath(fallbackPath).replace(/[^a-z0-9]+/gi, "")}`;
    };

    const groupFor = (key, seed = {}) => {
      if (!groups.has(key)) {
        groups.set(key, {
          id: `song-${key.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "")}`,
          groupKey: key,
          compactKey: key.split(":").slice(1).join(":"),
          path: seed.path || "",
          title: seed.title || "",
          artist: seed.artist || DEFAULT_ARTIST,
          artistKey: seed.artistKey || artistKeyFor(seed.artist || DEFAULT_ARTIST),
          album: "",
          date: "",
          duration: "",
          node: null,
          audio: null,
          lyricsNode: null,
          audioVersions: [],
          lyricsNodes: [],
          itFiles: [],
          noteNodes: [],
          searchParts: [],
        });
      }
      return groups.get(key);
    };

    const addPath = (item, path) => {
      if (path) byPath[normalizePath(path)] = item;
    };

    const addAudioVersion = (group, node) => {
      const music = node.music || {};
      const artist = music.artist || DEFAULT_ARTIST;
      const version = {
        node,
        path: node.path,
        title: node.title,
        artist,
        artistKey: music.artistKey || artistKeyFor(artist),
        album: music.album || "",
        date: node.date || "",
        duration: music.duration || "",
        audio: node.audio || null,
      };
      group.audioVersions.push(version);
      group.searchParts.push(node.title, artist, music.album, node.date, music.searchText);
      if (node.bodyHtml) group.noteNodes.push(node);
    };

    for (const node of audioNodes) {
      const linked = linkedMediaFor(node.path);
      const lyricsPath = linked.lyricsPath || node.lyricsPath || "";
      const lyricsNode = lyricsPath ? lyricsByPath.get(lyricsPath) : null;
      const music = node.music || {};
      const artist = music.artist || DEFAULT_ARTIST;
      const artistKey = music.artistKey || artistKeyFor(artist);
      const group = groupFor(groupKeyFor(artistKey, node.title, node.path, linked), {
        path: node.path,
        title: node.title,
        artist,
        artistKey,
      });
      addAudioVersion(group, node);
      if (lyricsNode) {
        usedLyrics.add(lyricsNode.path);
        group.lyricsNodes.push(lyricsNode);
        group.searchParts.push(lyricsNode.title);
      }
      const itFiles = itFilesFor(linked);
      group.itFiles.push(...itFiles);
      rememberItFiles(itFiles, usedItFiles);
    }

    for (const node of nodesForList("lyrics")) {
      if (usedLyrics.has(node.path)) continue;
      const linked = linkedMediaFor(node.path);
      const group = groupFor(groupKeyFor(DEFAULT_ARTIST, node.title, node.path, linked), {
        path: node.path,
        title: node.title,
        artist: DEFAULT_ARTIST,
        artistKey: "industree",
      });
      group.lyricsNodes.push(node);
      group.searchParts.push(node.title, node.date);
      const itFiles = itFilesFor(linked);
      group.itFiles.push(...itFiles);
      rememberItFiles(itFiles, usedItFiles);
    }

    const matchItGroup = (file) => {
      const fileKey = fileKeyFor(file.name);
      let best = null;
      let secondBest = 0;
      for (const group of groups.values()) {
        if (!group.audioVersions.length && !group.lyricsNodes.length) continue;
        const score = similarityScore(fileKey, group.compactKey);
        if (!best || score > best.score) {
          secondBest = best?.score || 0;
          best = { group, score };
        } else if (score > secondBest) {
          secondBest = score;
        }
      }
      if (!best) return null;
      const strong = best.score >= 0.72;
      const broad = best.score >= 0.58 && best.score - secondBest >= 0.04;
      return strong || broad ? best.group : null;
    };

    for (const file of archive.impulse?.files || []) {
      if (usedItFiles.has(file.name)) continue;
      const matchedGroup = matchItGroup(file);
      if (matchedGroup) {
        matchedGroup.itFiles.push(file);
        matchedGroup.searchParts.push(file.name, slugLabel(file.name));
        usedItFiles.add(file.name);
        continue;
      }
      const key = `impulse-tracker:${fileKeyFor(file.name) || file.name.toLowerCase()}`;
      const group = groupFor(key, {
        path: `impulse/${file.name}`,
        title: slugLabel(file.name) || file.name,
        artist: IMPULSE_ARTIST,
        artistKey: "impulse-tracker",
      });
      group.itFiles.push(file);
      group.searchParts.push(file.name, slugLabel(file.name), IMPULSE_ARTIST);
    }

    const primaryAudioRank = (version) => {
      const title = version.title || "";
      let score = 0;
      if (!/^\s*\d+\s*[-._]/.test(title)) score += 20;
      if (version.album) score += 10;
      if (!/\blive\b/i.test(title)) score += 4;
      if (!/\b(demo|draft|rough|alternate)\b/i.test(title)) score += 3;
      return score;
    };

    const items = [...groups.values()]
      .map((item) => {
        item.audioVersions = uniqueBy(item.audioVersions, (version) => version.path);
        item.lyricsNodes = uniqueBy(item.lyricsNodes, (node) => node.path);
        item.itFiles = uniqueBy(item.itFiles, (file) => file.name);
        item.noteNodes = uniqueBy(item.noteNodes, (node) => node.path)
          .filter((node) => !item.lyricsNodes.some((lyrics) => lyrics.path === node.path));
        const primaryAudio = item.audioVersions
          .slice()
          .sort((a, b) => primaryAudioRank(b) - primaryAudioRank(a))[0];
        const primaryLyrics = item.lyricsNodes[0] || null;
        item.node = primaryAudio?.node || primaryLyrics || null;
        item.path = primaryAudio?.path || primaryLyrics?.path || `impulse/${item.itFiles[0]?.name || ""}`;
        item.title = primaryAudio?.title || primaryLyrics?.title || slugLabel(item.itFiles[0]?.name) || item.title;
        item.artist = primaryAudio?.artist || item.artist;
        item.artistKey = primaryAudio?.artistKey || item.artistKey;
        item.album = primaryAudio?.album || "";
        item.date = primaryAudio?.date || "";
        item.duration = primaryAudio?.duration || "";
        item.audio = primaryAudio?.audio || null;
        item.lyricsNode = primaryLyrics;
        item.hasAudio = item.audioVersions.some((version) => version.audio?.source);
        item.hasLyrics = item.lyricsNodes.length > 0;
        item.hasIt = item.itFiles.length > 0;
        item.searchText = searchTextFor(
          item.title,
          item.artist,
          item.album,
          item.date,
          item.audioVersions.map((version) => [version.title, version.artist, version.album, version.date, version.duration]),
          item.lyricsNodes.map((node) => node.title),
          item.itFiles.map((file) => file.name),
          item.searchParts,
        );
        return item;
      })
      .sort((a, b) => a.title.localeCompare(b.title));

    for (const item of items) {
      byId[item.id] = item;
      addPath(item, item.path);
      for (const version of item.audioVersions) addPath(item, version.path);
      for (const node of item.lyricsNodes) addPath(item, node.path);
      for (const file of item.itFiles) addPath(item, `impulse/${file.name}`);
    }

    archive.musicCatalog = items;
    archive.musicItemsByPath = byPath;
    archive.musicItemsById = byId;
  };

  const albumTitleFor = (rawTitle = "") => {
    const trimmed = String(rawTitle || "").trim();
    return ALBUM_ALIASES[trimmed] || trimmed;
  };

  const isInformativeAlbumTitle = (title, artist = "") => {
    const clean = albumTitleFor(title);
    const lower = clean.toLowerCase();
    if (GENERIC_ALBUM_TITLES.has(lower)) return false;
    if (/^https?:\/\//i.test(clean) || lower.includes("303.nu")) return false;
    if ((clean.match(/\(/g) || []).length !== (clean.match(/\)/g) || []).length) return false;
    const key = `${artistKeyFor(artist)}:${slugFor(clean)}`;
    if (ALBUM_EXCLUSIONS.has(key)) return false;
    return Boolean(clean);
  };

  const parseDurationSeconds = (duration = "") => {
    const parts = String(duration || "")
      .split(":")
      .map((part) => Number(part));
    if (parts.some((part) => !Number.isFinite(part))) return 0;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  };

  const formatDuration = (seconds) => {
    if (!seconds) return "";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    return `${minutes}:${String(secs).padStart(2, "0")}`;
  };

  const yearFor = (...values) => {
    for (const value of values) {
      const match = String(value || "").match(/\b(19|20)\d{2}\b/);
      if (match) return match[0];
    }
    return "";
  };

  const trackNumberFor = (title = "") => {
    const match = String(title || "").match(/^\s*(\d+)\s*[-._]/);
    return match ? Number(match[1]) : 0;
  };

  const albumVersionFor = (item, albumTitle) =>
    item.audioVersions?.find((version) => albumTitleFor(version.album) === albumTitle && version.audio?.source)
    || item.audioVersions?.find((version) => albumTitleFor(version.album) === albumTitle)
    || audioVersionFor(item)
    || null;

  const prepareAlbumCatalog = () => {
    const albums = new Map();
    const byPath = {};
    for (const item of archive.musicCatalog || []) item.albumRefs = [];

    const albumFor = (artist, title) => {
      const artistKey = artistKeyFor(artist);
      const cleanTitle = albumTitleFor(title);
      const key = `${artistKey}:${slugFor(cleanTitle)}`;
      if (!albums.has(key)) {
        albums.set(key, {
          id: key,
          key,
          title: cleanTitle,
          artist,
          artistKey,
          path: `albums/${artistKey}/${slugFor(cleanTitle)}`,
          tracks: [],
          searchText: searchTextFor(cleanTitle, artist),
          year: yearFor(cleanTitle),
          durationSeconds: 0,
        });
      }
      return albums.get(key);
    };

    for (const item of archive.musicCatalog || []) {
      const seenAlbumKeys = new Set();
      for (const version of item.audioVersions || []) {
        const albumTitle = albumTitleFor(version.album);
        if (!isInformativeAlbumTitle(albumTitle, version.artist || item.artist)) continue;
        const album = albumFor(version.artist || item.artist, albumTitle);
        if (seenAlbumKeys.has(album.key)) continue;
        seenAlbumKeys.add(album.key);
        album.tracks.push({
          item,
          version: albumVersionFor(item, album.title),
          titleKey: titleKeyFor(item.title, item.path),
          sourceIndex: version.node?.id || 0,
        });
        album.searchText = searchTextFor(album.searchText, item.title, version.title, version.date);
        album.year ||= yearFor(version.date);
      }
    }

    const albumList = [...albums.values()]
      .filter((album) => album.tracks.length >= 2 && !ALBUM_EXCLUSIONS.has(album.key))
      .map((album) => {
        const manual = ALBUM_TRACKLISTS[album.key] || [];
        album.tracks = uniqueBy(album.tracks, (track) => track.item.id)
          .sort((a, b) => {
            const manualA = manual.indexOf(a.titleKey);
            const manualB = manual.indexOf(b.titleKey);
            if (manualA !== -1 || manualB !== -1) return (manualA === -1 ? 999 : manualA) - (manualB === -1 ? 999 : manualB);
            const numberA = trackNumberFor(a.version?.title || a.item.title);
            const numberB = trackNumberFor(b.version?.title || b.item.title);
            if (numberA || numberB) return (numberA || 999) - (numberB || 999);
            return a.sourceIndex - b.sourceIndex || a.item.title.localeCompare(b.item.title);
          })
          .map((track, index) => ({ ...track, number: index + 1 }));
        album.durationSeconds = album.tracks.reduce((total, track) => total + parseDurationSeconds(track.version?.duration), 0);
        album.trackCount = album.tracks.length;
        return album;
      })
      .sort((a, b) => a.artist.localeCompare(b.artist) || (a.year || "9999").localeCompare(b.year || "9999") || a.title.localeCompare(b.title));

    for (const album of albumList) {
      byPath[normalizePath(album.path)] = album;
      for (const track of album.tracks) {
        if (!track.item.albumRefs.some((ref) => ref.key === album.key)) {
          track.item.albumRefs.push(album);
        }
      }
    }

    archive.albumCatalog = albumList;
    archive.albumsByPath = byPath;
  };

  let impulseRuntimePromise;

  const loadScript = (src) => new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      if (window.initIndusTreeImpulsePlayer) resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });

  const ensureImpulseRuntime = () => {
    const styleHref = new URL("impulse-player.css?v=3", assetBase).toString();
    if (!document.querySelector(`link[href="${styleHref}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = styleHref;
      document.head.appendChild(link);
    }
    if (!impulseRuntimePromise) {
      impulseRuntimePromise = loadScript(new URL("impulse-player.js?v=4", assetBase).toString());
    }
    return impulseRuntimePromise;
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

  const audioPanelHtml = (node, item = null) => {
    const audio = node.audio;
    if (!audio) {
      return '<div class="audio-panel"><p>No audio metadata found.</p></div>';
    }

    const chunks = ['<div class="audio-panel">'];
    if (audio.source) {
      if (item?.id) {
        chunks.push(`<p><button class="button" type="button" data-track-id="${escapeHtml(item.id)}" data-track-kind="audio">Play audio</button></p>`);
      }
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

  const countBadge = (label, count) => {
    if (!count) return "";
    return count > 1 ? `${label} x${count}` : label;
  };

  const mediaBadgesHtml = (item) => [
    countBadge("Audio", item.audioVersions?.filter((version) => version.audio?.source).length || (item.hasAudio ? 1 : 0)),
    countBadge("IT", item.itFiles?.length || (item.hasIt ? 1 : 0)),
    countBadge("Lyrics", item.lyricsNodes?.length || (item.hasLyrics ? 1 : 0)),
  ].filter(Boolean)
    .map((label) => `<span class="media-badge">${escapeHtml(label)}</span>`)
    .join("");

  const versionMetaHtml = (values) => {
    const meta = values.filter(Boolean).join(" / ");
    return meta ? `<p class="version-meta">${escapeHtml(meta)}</p>` : "";
  };

  const audioDetailValue = (audio, label) =>
    audio.details?.find((detail) => detail.label === label)?.value || "";

  const audioVersionRowHtml = (item, version) => {
    const audio = version.audio || {};
    const actions = audio.source
      ? `<button class="button" type="button" data-track-id="${escapeHtml(item.id)}" data-track-kind="audio" data-track-target="${escapeHtml(version.path)}">Play</button>
      <a class="button" href="${escapeHtml(audio.download || audio.source)}">Download</a>`
      : '<span class="missing-media">Missing</span>';
    const genre = audioDetailValue(audio, "Genre");
    const length = audioDetailValue(audio, "Length") || version.duration || "";
    const format = audioDetailValue(audio, "Restored format") || "";
    const match = audioDetailValue(audio, "Restored match") || "";
    return `<article class="song-version song-version-audio">
  <div class="song-version-main">
    <h3>${escapeHtml(version.title)}</h3>
    ${versionMetaHtml([version.artist, version.album, version.date, genre])}
    ${audio.mediaNote ? `<p class="media-note">${escapeHtml(audio.mediaNote)}</p>` : ""}
    ${audio.missingMessage ? `<p class="missing-media">${escapeHtml(audio.missingMessage)}</p>` : ""}
  </div>
  <span class="song-version-cell">${escapeHtml(length || "-")}</span>
  <span class="song-version-cell">${escapeHtml(format || "-")}</span>
  <span class="song-version-cell">${escapeHtml(match || "-")}</span>
  <div class="song-version-actions">${actions}</div>
</article>`;
  };

  const itVersionRowHtml = (item, file) => `<article class="song-version song-version-it">
  <div class="song-version-main">
    <h3>${escapeHtml(file.name)}</h3>
    <p class="version-meta">Impulse Tracker</p>
  </div>
  <span class="song-version-cell">-</span>
  <span class="song-version-cell">IT</span>
  <span class="song-version-cell">Original</span>
  <div class="song-version-actions">
    <button class="button" type="button" data-track-id="${escapeHtml(item.id)}" data-track-kind="it" data-track-target="${escapeHtml(file.name)}">Play</button>
    <a class="button" href="${escapeHtml(file.url)}">Download</a>
  </div>
</article>`;

  const versionsPanelHtml = (item) => {
    const rows = [
      ...(item.audioVersions || []).map((version) => audioVersionRowHtml(item, version)),
      ...(item.itFiles || []).map((file) => itVersionRowHtml(item, file)),
    ];
    if (!rows.length) return "";
    return `<section class="song-panel song-versions-panel" aria-labelledby="song-versions-title">
  <h2 id="song-versions-title">Versions</h2>
  <div class="song-version-list">
    <div class="song-version song-version-head" aria-hidden="true">
      <span>Title</span>
      <span>Length</span>
      <span>Format</span>
      <span>Match</span>
      <span>Actions</span>
    </div>
    ${rows.join("\n")}
  </div>
</section>`;
  };

  const lyricsPanelHtml = (item) => {
    const lyricsNodes = (item.lyricsNodes?.length ? item.lyricsNodes : [item.lyricsNode])
      .filter((node) => node?.bodyHtml);
    if (!lyricsNodes.length) return "";
    const content = lyricsNodes.map((lyrics, index) => {
      const heading = lyricsNodes.length > 1 ? `<h3>${escapeHtml(lyrics.title)}</h3>` : "";
      return `${heading}<div class="content">${lyrics.bodyHtml}</div>${index < lyricsNodes.length - 1 ? '<hr class="song-panel-separator">' : ""}`;
    }).join("\n");
    return `<section class="song-panel song-lyrics-panel" aria-labelledby="song-lyrics-title">
  <h2 id="song-lyrics-title">Lyrics</h2>
  ${content}
</section>`;
  };

  const notesPanelHtml = (item) => {
    const nodes = (item.noteNodes?.length ? item.noteNodes : [item.node])
      .filter((node) => node?.bodyHtml && !item.lyricsNodes?.some((lyrics) => lyrics.path === node.path));
    if (!nodes.length) return "";
    const content = nodes.map((node) => {
      const heading = nodes.length > 1 ? `<h3>${escapeHtml(node.title)}</h3>` : "";
      return `${heading}<div class="content">${node.bodyHtml}</div>`;
    }).join("\n");
    return `<section class="song-panel song-notes-panel"><h2>Notes</h2>${content}</section>`;
  };

  const albumLinksHtml = (item) => {
    if (!item.albumRefs?.length) return "";
    return `<p class="related album-links">Album: ${item.albumRefs
      .map((album) => `<a href="${routeHref(album.path)}">${escapeHtml(album.title)}</a>`)
      .join(", ")}</p>`;
  };

  const songHtml = (item) => {
    const chunks = [`<article class="node node-song">`, `<h1>${escapeHtml(item.title)}</h1>`];
    const meta = [item.artist, item.album, item.date].filter(Boolean).join(" / ");
    if (meta) chunks.push(`<p class="meta">${escapeHtml(meta)}</p>`);
    chunks.push(`<div class="song-media-badges">${mediaBadgesHtml(item)}</div>`);
    chunks.push(albumLinksHtml(item));
    chunks.push(versionsPanelHtml(item));
    if (item.hasLyrics) chunks.push(lyricsPanelHtml(item));
    chunks.push(notesPanelHtml(item));
    chunks.push("</article>");
    return chunks.join("\n");
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

  const homeArchiveHtml = () => {
    const home = archive.lists.home;
    const welcome = nodeById(home.welcomeId);
    const featured = nodesForIds(home.featuredIds)
      .map((node) => cardHtml(node))
      .join("\n");
    if (!welcome && !featured) return "";
    return `<section class="listing about-home-archive" aria-labelledby="about-home-archive-title">
  <h2 id="about-home-archive-title">Archive intro</h2>
  ${welcome?.bodyHtml ? `<div class="content">${welcome.bodyHtml}</div>` : ""}
  ${featured
    ? `<section class="list-section"><h2>Previously featured</h2><div class="cards compact">${featured}</div></section>`
    : ""}
</section>`;
  };

  const renderAbout = (node) => {
    setMeta(node.title, node.excerpt);
    app.innerHTML = nodeHtml(node) + homeArchiveHtml();
  };

  const renderHome = () => {
    applyMusicFilterHash("all");
    renderAudioList();
  };

  const renderList = (key, title, lede = "") => {
    const nodes = nodesForList(key);
    setMeta(title);
    app.innerHTML = `<section class="page">
  <h1>${escapeHtml(title)}</h1>
  ${lede ? `<p class="lede">${escapeHtml(lede.replace("{count}", nodes.length))}</p>` : ""}
  <div class="cards compact">${nodes.map((node) => cardHtml(node, true)).join("\n")}</div>
</section>`;
  };

  const renderAlbumList = () => {
    const albums = archive.albumCatalog || [];
    const artists = new Set(albums.map((album) => album.artist));
    setMeta("Albums");
    app.innerHTML = `<section class="page albums-page">
  <div class="music-hero">
    <div>
      <h1>Albums</h1>
      <p class="lede">Reconstructed releases, EPs, collections, and sessions from the music archive.</p>
    </div>
  </div>
  <section class="album-list" aria-labelledby="album-list-title">
    <div class="music-results-head">
      <h2 id="album-list-title">Albums</h2>
      <span>${albums.length} albums / ${artists.size} artists</span>
    </div>
    <div class="album-table">
      <div class="album-row album-row-head" aria-hidden="true">
        <span>Album</span>
        <span>Year</span>
        <span>Tracks</span>
        <span>Length</span>
      </div>
      ${albums.map(albumListRowHtml).join("\n")}
    </div>
  </section>
</section>`;
  };

  const renderAlbumPage = (album) => {
    const duration = formatDuration(album.durationSeconds);
    const meta = [album.artist, album.year, `${album.trackCount} tracks`, duration].filter(Boolean).join(" / ");
    setMeta(album.title, `${album.title} by ${album.artist}`);
    app.innerHTML = `<article class="node node-album">
  <h1>${escapeHtml(album.title)}</h1>
  ${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ""}
  <section class="song-panel album-track-panel" aria-labelledby="album-tracklist-title">
    <h2 id="album-tracklist-title">Tracklist</h2>
    <div class="album-track-list">
      <div class="album-track album-track-head" aria-hidden="true">
        <span>#</span>
        <span>Title</span>
        <span>Length</span>
        <span>Format</span>
        <span>Actions</span>
      </div>
      ${album.tracks.map((track) => albumTrackRowHtml(album, track)).join("\n")}
    </div>
  </section>
</article>`;
  };

  const artistCounts = (nodes) => {
    const counts = new Map();
    for (const node of nodes) {
      const artist = node.artist || node.music?.artist || DEFAULT_ARTIST;
      counts.set(artist, (counts.get(artist) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };

  const trackKindFor = (item, requestedKind = musicState.currentKind) => {
    if (requestedKind === "it" && item.hasIt) return "it";
    return item.hasAudio ? "audio" : "it";
  };

  const audioVersionFor = (item, target = "") =>
    item.audioVersions?.find((version) => version.path === target && version.audio?.source)
    || item.audioVersions?.find((version) => version.audio?.source)
    || null;

  const itFileFor = (item, target = "") =>
    item.itFiles?.find((file) => file.name === target)
    || item.itFiles?.[0]
    || null;

  const defaultTargetFor = (item, kind) => (kind === "it"
    ? itFileFor(item)?.name || ""
    : audioVersionFor(item)?.path || "");

  const playerKeyFor = (item, kind, target = "") => `${item.id}:${kind}:${target || defaultTargetFor(item, kind)}`;

  const playMixtapeAudio = (host) =>
    host.querySelector("[data-mixtape-audio]")?.play().catch(() => {});

  const nodeMatchesMusicState = (item) => {
    if (musicState.status === "audio" && !item.hasAudio) return false;
    if (musicState.status === "it" && !item.hasIt) return false;
    if (musicState.status === "lyrics" && !item.hasLyrics) return false;
    if (musicState.artist !== "all" && item.artistKey !== musicState.artist) return false;
    const query = musicState.query.trim().toLowerCase();
    if (query && !(item.searchText || "").includes(query)) return false;
    return true;
  };

  const trackRowHtml = (item) => {
    const isActive = item.id === musicState.currentId;
    const detail = routeHref(item.path);
    const album = item.album ? ` / ${escapeHtml(item.album)}` : "";
    const versionCount = (item.audioVersions?.length || 0) + (item.itFiles?.length || 0);
    const sideText = versionCount > 1 ? `${versionCount} versions` : item.duration || item.date || (item.itFiles?.[0]?.name ?? "");
    const canPlay = item.hasAudio || item.hasIt;
    const rowKind = trackKindFor(item, musicState.status);
    const rowTarget = defaultTargetFor(item, rowKind);
    const control = canPlay
      ? `<button class="track-load" type="button" data-track-id="${escapeHtml(item.id)}" data-track-kind="${escapeHtml(rowKind)}" data-track-target="${escapeHtml(rowTarget)}" aria-label="Play ${escapeHtml(item.title)}">${escapeHtml(rowKind === "audio" ? ">" : "IT")}</button>`
      : `<span class="track-missing-mark" aria-hidden="true">${escapeHtml(item.hasIt ? "IT" : item.hasLyrics ? "Ly" : "-")}</span>`;
    return `<article class="mixtape-track${canPlay ? "" : " is-missing"}${isActive ? " is-active" : ""}">
  ${control}
  <div class="track-main">
    <span class="track-title">${escapeHtml(item.title)}</span>
    <p class="track-meta">${escapeHtml(item.artist)}${album}</p>
  </div>
  <div class="track-side">
    <span>${escapeHtml(sideText)}</span>
    <span class="track-status">${mediaBadgesHtml(item)}</span>
    <a class="track-detail" href="${detail}">Open</a>
  </div>
</article>`;
  };

  const albumListRowHtml = (album) => {
    const duration = formatDuration(album.durationSeconds);
    return `<article class="album-row">
  <div class="album-main">
    <a class="album-title" href="${routeHref(album.path)}">${escapeHtml(album.title)}</a>
    <span class="album-meta">${escapeHtml(album.artist)}</span>
  </div>
  <span>${escapeHtml(album.year || "-")}</span>
  <span>${album.trackCount}</span>
  <span>${escapeHtml(duration || "-")}</span>
</article>`;
  };

  const albumTrackRowHtml = (album, track) => {
    const item = track.item;
    const version = track.version;
    const audio = version?.audio || {};
    const length = audioDetailValue(audio, "Length") || version?.duration || "";
    const format = audioDetailValue(audio, "Restored format") || "";
    const target = version?.path || defaultTargetFor(item, "audio");
    return `<article class="album-track">
  <span class="album-track-number">${track.number}</span>
  <div class="album-track-main">
    <a class="album-track-title" href="${routeHref(item.path)}">${escapeHtml(item.title)}</a>
    ${version?.title && version.title !== item.title ? `<p class="version-meta">${escapeHtml(version.title)}</p>` : ""}
  </div>
  <span class="song-version-cell">${escapeHtml(length || "-")}</span>
  <span class="song-version-cell">${escapeHtml(format || "-")}</span>
  <div class="song-version-actions">
    <button class="button" type="button" data-track-id="${escapeHtml(item.id)}" data-track-kind="audio" data-track-target="${escapeHtml(target)}">Play</button>
    ${audio.download || audio.source ? `<a class="button" href="${escapeHtml(audio.download || audio.source)}">Download</a>` : ""}
  </div>
</article>`;
  };

  const audioPlayerHtml = (item, version) => {
    const duration = version.duration ? ` / ${version.duration}` : "";
    const source = version.audio?.source || "";
    const download = version.audio?.download || source;
    return `<aside class="bottom-player" aria-label="Music player">
  <div class="bottom-player-inner">
    <div>
      <strong class="bottom-player-title">${escapeHtml(version.title || item.title)}</strong>
      <span class="bottom-player-meta">${escapeHtml((version.artist || item.artist) + duration)}</span>
    </div>
    <audio controls preload="metadata" src="${escapeHtml(source)}" data-mixtape-audio></audio>
    <div><a href="${escapeHtml(download)}" download>Download</a></div>
  </div>
</aside>`;
  };

  const impulsePlayerHtml = (item, file) => `<aside class="bottom-player bottom-player-it" aria-label="Impulse Tracker player">
  <div class="bottom-player-inner">
    <div>
      <strong class="bottom-player-title">${escapeHtml(item.title)}</strong>
      <span class="bottom-player-meta">${escapeHtml(file.name)}</span>
    </div>
    <div class="bottom-impulse-mount" id="persistentImpulseMount">
      <p class="missing-media">Loading IT player...</p>
    </div>
    <div><a href="${escapeHtml(file.url)}" download>Download</a></div>
  </div>
</aside>`;

  const ensurePlayerHost = () => {
    if (playerHost) return playerHost;
    playerHost = document.getElementById("persistentPlayerHost");
    if (!playerHost) {
      playerHost = document.createElement("div");
      playerHost.id = "persistentPlayerHost";
      document.body.appendChild(playerHost);
    }
    return playerHost;
  };

  const stopImpulsePlayer = () => {
    if (window.__industreeImpulseStop) {
      try { window.__industreeImpulseStop(); } catch (_) {}
    }
  };

  const updatePersistentPlayer = ({ autoplay = false } = {}) => {
    const host = ensurePlayerHost();
    const item = musicState.currentId ? archive.musicItemsById[musicState.currentId] : null;
    if (!item || (!item.hasAudio && !item.hasIt)) {
      if (persistentPlayer.kind === "it") stopImpulsePlayer();
      persistentPlayer = { kind: "", key: "" };
      host.innerHTML = "";
      document.body.classList.remove("has-mixtape-player");
      return;
    }

    const kind = trackKindFor(item);
    const target = musicState.currentTarget || defaultTargetFor(item, kind);
    const version = kind === "audio" ? audioVersionFor(item, target) : null;
    const file = kind === "it" ? itFileFor(item, target) : null;
    const key = playerKeyFor(item, kind, target);
    document.body.classList.add("has-mixtape-player");

    if (persistentPlayer.kind === kind && persistentPlayer.key === key) {
      if (autoplay && kind === "audio") playMixtapeAudio(host);
      return;
    }

    if (persistentPlayer.kind === "it" && kind !== "it") stopImpulsePlayer();
    persistentPlayer = { kind, key };

    if (kind === "audio") {
      if (!version) return;
      host.innerHTML = audioPlayerHtml(item, version);
      if (autoplay) playMixtapeAudio(host);
      return;
    }

    if (!file) return;
    host.innerHTML = impulsePlayerHtml(item, file);
    ensureImpulseRuntime()
      .then(() => {
        window.initIndusTreeImpulsePlayer?.({
          mountId: "persistentImpulseMount",
          baseUrl: archive.impulse?.baseUrl,
          files: [file],
          initialFile: file.name,
          compact: true,
          label: file.name,
          autoplay,
        });
      })
      .catch((error) => {
        console.error(error);
        const mount = document.getElementById("persistentImpulseMount");
        if (mount) {
          mount.innerHTML = '<p class="missing-media">The Impulse player could not be loaded.</p>';
        }
      });
  };

  const renderAudioList = () => {
    const nodes = archive.musicCatalog || [];
    const withAudio = nodes.filter((item) => item.hasAudio);
    const withIt = nodes.filter((item) => item.hasIt);
    const withLyrics = nodes.filter((item) => item.hasLyrics);
    const filtered = nodes.filter(nodeMatchesMusicState);
    const artists = artistCounts(nodes);
    const artistKeys = new Map(nodes.map((item) => [
      item.artist,
      item.artistKey,
    ]));
    const artistOptions = [
      ["All", "all", nodes.length],
      ...artists.map(([artist, count]) => [artist, artistKeys.get(artist), count]),
    ].filter(([, key]) => key);
    const statusButtons = [
      ["All", "all", nodes.length],
      ["Audio", "audio", withAudio.length],
      ["IT", "it", withIt.length],
      ["Lyrics", "lyrics", withLyrics.length],
    ];
    const albumCount = archive.albumCatalog?.length || 0;
    setMeta("Music");
    app.innerHTML = `<section class="page music-page${musicState.currentId ? " has-player" : ""}">
  <div class="music-hero">
    <div>
      <h1>Music</h1>
      <p class="lede">Songs, lyrics, restored audio, and original Impulse Tracker files from the IndusTree orbit.</p>
    </div>
  </div>
  <div class="music-tools">
    <label class="music-search">
      <span class="visually-hidden">Search music</span>
      <input type="search" value="${escapeHtml(musicState.query)}" placeholder="Search songs, artists, files..." data-music-search>
    </label>
    <div class="music-filter-row" aria-label="Song media">
      ${statusButtons.map(musicFilterHtml).join("\n")}
      <a class="music-filter" href="${routeHref("albums")}" aria-pressed="false">${escapeHtml(countLabel("Albums", albumCount))}</a>
    </div>
    <label class="music-artist-select">
      <span class="visually-hidden">Artist</span>
      <select data-music-artist-select>
        ${artistOptions.map((option) => optionHtml(option, musicState.artist)).join("\n")}
      </select>
    </label>
  </div>
  <section class="music-results" aria-labelledby="music-results-title">
    <div class="music-results-head">
      <h2 id="music-results-title">Songs</h2>
      <span>${filtered.length} shown</span>
    </div>
    ${filtered.length ? filtered.map(trackRowHtml).join("\n") : '<p class="mixtape-empty">No songs match these filters.</p>'}
  </section>
</section>`;
  };

  const renderSongPage = (item) => {
    setMeta(item.title, item.node?.excerpt || archive.site.description);
    app.innerHTML = songHtml(item);
  };

  const renderImpulse = () => {
    musicState.status = "it";
    renderAudioList();
  };

  const renderLyrics = () => {
    musicState.status = "lyrics";
    renderAudioList();
  };

  const renderNotFound = () => {
    setMeta("Page not found");
    app.innerHTML = `<section class="page">
  <h1>Page not found</h1>
  <p>This static archive may have a different path than the old Drupal site.</p>
  <p><a href="/">Return to Music</a></p>
</section>`;
  };

  const renderRoute = () => {
    const path = canonicalPath(currentRoutePath());
    const songItem = archive.musicItemsByPath?.[path];
    const album = archive.albumsByPath?.[path];
    renderNav(path);

    if (!path) return renderHome();
    if (path === "albums") return renderAlbumList();
    if (album) return renderAlbumPage(album);
    if (isMusicPagePath(path)) {
      applyMusicFilterHash(defaultMusicStatusForPath(path));
      return renderAudioList();
    }
    if (songItem) return renderSongPage(songItem);
    if (path === "archive") {
      return renderList("archive", "Archive", "{count} published nodes converted from Drupal 6.");
    }
    const nodeId = archive.pathToNode[path];
    if (nodeId) {
      const node = archive.nodes[String(nodeId)];
      const item = archive.musicItemsByPath?.[node.path];
      if (item) return renderSongPage(item);
      if (node.path === "about") return renderAbout(node);
      setMeta(node.title, node.excerpt);
      app.innerHTML = nodeHtml(node);
      return;
    }
    renderNotFound();
    updatePersistentPlayer();
  };

  const renderNav = (currentPath = canonicalPath(currentRoutePath())) => {
    if (!nav) return;
    const currentNode = archive.nodes[String(archive.pathToNode[currentPath] || "")];
    const currentSong = archive.musicItemsByPath?.[currentPath];
    const items = [
      ...archive.nav,
      { path: "albums", title: "Albums" },
    ].map((item) => {
      const itemPath = canonicalPath(item.path);
      const active = itemPath === currentPath
        || (!itemPath && !currentPath)
        || (itemPath === "albums" && (currentPath === "albums" || currentPath.startsWith("albums/")))
        || (itemPath === "audio" && (
          !currentPath
          || isMusicPagePath(currentPath)
          || currentPath.startsWith("audio/")
          || currentPath.startsWith("lyrics/")
          || currentPath.startsWith("impulse/")
          || currentNode?.type === "audio"
          || currentNode?.type === "lyrics"
          || currentSong
        ));
      return `<li><a href="${routeHref(item.path)}"${active ? ' aria-current="page"' : ""}>${escapeHtml(item.title)}</a></li>`;
    });
    nav.innerHTML = `<ul>${items.join("\n")}</ul>`;
  };

  const selectTrack = (id, shouldPlay = true, requestedKind = "", requestedTarget = "") => {
    const item = archive.musicItemsById[id];
    if (!item || (!item.hasAudio && !item.hasIt)) return;
    const kind = trackKindFor(item, requestedKind);
    musicState.currentId = id;
    musicState.currentKind = kind;
    musicState.currentTarget = requestedTarget || defaultTargetFor(item, kind);
    if (isMusicPagePath(canonicalPath(currentRoutePath()))) {
      renderAudioList();
    }
    updatePersistentPlayer({ autoplay: shouldPlay });
  };

  const handleMusicInput = (event) => {
    const input = event.target.closest("[data-music-search]");
    if (!input) return;
    musicState.query = input.value;
    renderAudioList();
    const nextInput = app.querySelector("[data-music-search]");
    if (nextInput) {
      nextInput.focus();
      nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
    }
  };

  const handleMusicChange = (event) => {
    const select = event.target.closest("[data-music-artist-select]");
    if (!select) return;
    musicState.artist = select.value || "all";
    history.pushState({}, "", musicFilterHref());
    renderRoute();
  };

  const handleClick = (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const statusButton = event.target.closest("[data-music-status]");
    if (statusButton) {
      event.preventDefault();
      musicState.status = statusButton.dataset.musicStatus || "all";
      history.pushState({}, "", musicFilterHref());
      renderRoute();
      return;
    }

    const trackTrigger = event.target.closest("[data-track-id]");
    if (trackTrigger && !event.target.closest("a[href]")) {
      event.preventDefault();
      selectTrack(trackTrigger.dataset.trackId, true, trackTrigger.dataset.trackKind, trackTrigger.dataset.trackTarget);
      return;
    }

    const link = event.target.closest("a[href]");
    if (!link || link.target || link.hasAttribute("download")) return;

    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    if (isStaticAssetPath(url.pathname)) return;
    if (!url.pathname.startsWith("/impulse/") && /\.[a-z0-9]{2,5}$/i.test(url.pathname) && !url.pathname.endsWith("/index.html")) return;

    event.preventDefault();
    if (url.hash.startsWith("#/")) {
      history.pushState({}, "", routeHref(url.hash.slice(1)));
    } else {
      history.pushState({}, "", routeHref(url.pathname));
    }
    renderRoute();
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  fetch(dataUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Failed to load ${dataUrl.pathname}`);
      return response.json();
    })
    .then((data) => {
      archive = data;
      prepareMusicCatalog();
      prepareAlbumCatalog();
      document.querySelector(".brand")?.setAttribute("href", "/");
      document.querySelector(".brand img")?.setAttribute("src", archive.site.logo);
      document.querySelector(".brand img")?.setAttribute("alt", archive.site.name);
      const brandSlogan = document.querySelector(".brand em");
      if (brandSlogan) brandSlogan.textContent = archive.site.slogan;
      if (footer) footer.textContent = archive.site.footer;
      renderRoute();
      updatePersistentPlayer();
      document.addEventListener("click", handleClick);
      app.addEventListener("input", handleMusicInput);
      app.addEventListener("change", handleMusicChange);
      window.addEventListener("popstate", renderRoute);
      window.addEventListener("hashchange", renderRoute);
    })
    .catch((error) => {
      console.error(error);
      app.innerHTML = `<section class="page">
  <h1>Archive unavailable</h1>
  <p>The site data could not be loaded.</p>
</section>`;
    });
})();
