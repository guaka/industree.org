
(() => {
  const scriptUrl = new URL(document.currentScript.src);
  const assetBase = new URL(".", scriptUrl);
  const dataUrl = new URL("site-data.json?v=4", assetBase);
  const app = document.getElementById("app");
  const nav = document.querySelector("[data-nav]");
  const footer = document.querySelector("[data-footer]");
  let archive;
  const musicState = {
    artist: "all",
    query: "",
    status: "all",
    currentId: null,
  };

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

  const musicStatusFilters = new Set(["all", "audio", "it", "lyrics"]);

  const musicStatusAliases = {
    impulse: "it",
  };

  const musicHashFor = (status = "all", artist = "all") => {
    const cleanStatus = musicStatusFilters.has(status) ? status : "all";
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
    `<option value="${escapeHtml(key)}"${selected === key ? " selected" : ""}>${escapeHtml(countLabel(label, count))}</option>`;

  const musicFilterHtml = ([label, key, count]) =>
    `<a class="music-filter" href="${musicFilterHref(key, musicState.artist)}" data-music-status="${escapeHtml(key)}" aria-pressed="${musicState.status === key}">${escapeHtml(countLabel(label, count))}</a>`;

  const musicStatHtml = (label, count) =>
    `<span class="music-stat"><strong>${count}</strong>${escapeHtml(label)}</span>`;

  const slugLabel = (value) => String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  const artistKeyFor = (artist) => String(artist || "IndusTree")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "industree";

  const musicFilterStateFromHash = (defaultStatus = "all") => {
    const defaultState = {
      artist: "all",
      status: musicStatusFilters.has(defaultStatus) ? defaultStatus : "all",
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
        const status = musicStatusAliases[token] || token;
        if (musicStatusFilters.has(status)) {
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

  const prepareMusicCatalog = () => {
    const items = [];
    const byPath = {};
    const byId = {};
    const usedLyrics = new Set();
    const usedItFiles = new Set();
    const lyricsByPath = new Map(nodesForList("lyrics").map((node) => [node.path, node]));
    const audioNodes = nodesForList("audio");

    const addItem = (item) => {
      items.push(item);
      byId[item.id] = item;
      byPath[normalizePath(item.path)] = item;
      if (item.lyricsNode?.path && !byPath[normalizePath(item.lyricsNode.path)]) {
        byPath[normalizePath(item.lyricsNode.path)] = item;
      }
    };

    for (const node of audioNodes) {
      const linked = linkedMediaFor(node.path);
      const lyricsPath = linked.lyricsPath || node.lyricsPath || "";
      const lyricsNode = lyricsPath ? lyricsByPath.get(lyricsPath) : null;
      if (lyricsNode) usedLyrics.add(lyricsNode.path);
      const itFiles = (linked.itFiles || [])
        .map(impulseFileByName)
        .filter(Boolean);
      for (const file of itFiles) usedItFiles.add(file.name);
      const music = node.music || {};
      const artist = music.artist || "IndusTree";
      addItem({
        id: `node-${node.id}`,
        node,
        path: node.path,
        title: node.title,
        artist,
        artistKey: music.artistKey || artistKeyFor(artist),
        album: music.album || "",
        date: node.date || "",
        duration: music.duration || "",
        audio: node.audio || null,
        lyricsNode,
        itFiles,
        hasAudio: Boolean(node.audio?.source),
        hasLyrics: Boolean(lyricsNode),
        hasIt: itFiles.length > 0,
        searchText: searchTextFor(node.title, artist, music.album, node.date, music.searchText, lyricsNode?.title, itFiles.map((file) => file.name)),
      });
    }

    for (const node of nodesForList("lyrics")) {
      if (usedLyrics.has(node.path)) continue;
      const linked = linkedMediaFor(node.path);
      const itFiles = (linked.itFiles || [])
        .map(impulseFileByName)
        .filter(Boolean);
      for (const file of itFiles) usedItFiles.add(file.name);
      addItem({
        id: `node-${node.id}`,
        node,
        path: node.path,
        title: node.title,
        artist: "IndusTree",
        artistKey: "industree",
        album: "",
        date: node.date || "",
        duration: "",
        audio: null,
        lyricsNode: node,
        itFiles,
        hasAudio: false,
        hasLyrics: true,
        hasIt: itFiles.length > 0,
        searchText: searchTextFor(node.title, node.date, itFiles.map((file) => file.name)),
      });
    }

    for (const file of archive.impulse?.files || []) {
      if (usedItFiles.has(file.name)) continue;
      addItem({
        id: `it-${file.name}`,
        node: null,
        path: `impulse/${file.name}`,
        title: slugLabel(file.name) || file.name,
        artist: "Impulse Tracker",
        artistKey: "impulse-tracker",
        album: "",
        date: "",
        duration: "",
        audio: null,
        lyricsNode: null,
        itFiles: [file],
        hasAudio: false,
        hasLyrics: false,
        hasIt: true,
        searchText: searchTextFor(file.name, slugLabel(file.name), "Impulse Tracker"),
      });
    }

    archive.musicCatalog = items;
    archive.musicItemsByPath = byPath;
    archive.musicItemsById = byId;
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
    const styleHref = new URL("impulse-player.css?v=2", assetBase).toString();
    if (!document.querySelector(`link[href="${styleHref}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = styleHref;
      document.head.appendChild(link);
    }
    if (!impulseRuntimePromise) {
      impulseRuntimePromise = loadScript(new URL("impulse-player.js?v=3", assetBase).toString());
    }
    return impulseRuntimePromise;
  };

  const mountCompactImpulsePlayer = (file) => {
    if (!file) return;
    ensureImpulseRuntime()
      .then(() => {
        window.initIndusTreeImpulsePlayer?.({
          mountId: "songImpulseMount",
          baseUrl: archive.impulse?.baseUrl,
          files: [file],
          initialFile: file.name,
          compact: true,
          label: file.name,
        });
      })
      .catch((error) => {
        console.error(error);
        const mount = document.getElementById("songImpulseMount");
        if (mount) {
          mount.innerHTML = '<p class="missing-media">The Impulse player could not be loaded.</p>';
        }
      });
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

  const mediaBadgesHtml = (item) => [
    item.hasAudio ? "Audio" : "",
    item.hasIt ? "IT" : "",
    item.hasLyrics ? "Lyrics" : "",
  ].filter(Boolean)
    .map((label) => `<span class="media-badge">${escapeHtml(label)}</span>`)
    .join("");

  const impulsePanelHtml = (item) => {
    const file = item.itFiles?.[0];
    if (!file) return "";
    return `<section class="song-panel song-impulse-panel" aria-labelledby="song-impulse-title">
  <div class="song-panel-head">
    <h2 id="song-impulse-title">Impulse Tracker</h2>
    <a class="button" href="${escapeHtml(file.url)}">Download ${escapeHtml(file.name)}</a>
  </div>
  <div class="song-impulse-mount" id="songImpulseMount">
    <p class="missing-media">Loading IT player...</p>
  </div>
</section>`;
  };

  const lyricsPanelHtml = (item) => {
    const lyrics = item.lyricsNode;
    if (!lyrics?.bodyHtml) return "";
    return `<section class="song-panel song-lyrics-panel" aria-labelledby="song-lyrics-title">
  <h2 id="song-lyrics-title">Lyrics</h2>
  <div class="content">${lyrics.bodyHtml}</div>
</section>`;
  };

  const songHtml = (item) => {
    const node = item.node;
    const chunks = [`<article class="node node-song">`, `<h1>${escapeHtml(item.title)}</h1>`];
    const meta = [item.artist, item.album, item.date, item.duration].filter(Boolean).join(" / ");
    if (meta) chunks.push(`<p class="meta">${escapeHtml(meta)}</p>`);
    chunks.push(`<div class="song-media-badges">${mediaBadgesHtml(item)}</div>`);
    if (item.audio) chunks.push(audioPanelHtml({ audio: item.audio }));
    if (item.hasIt) chunks.push(impulsePanelHtml(item));
    if (item.hasLyrics) chunks.push(lyricsPanelHtml(item));
    if (node?.bodyHtml && node.path !== item.lyricsNode?.path) {
      chunks.push(`<section class="song-panel song-notes-panel"><h2>Notes</h2><div class="content">${node.bodyHtml}</div></section>`);
    }
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

  const artistCounts = (nodes) => {
    const counts = new Map();
    for (const node of nodes) {
      const artist = node.artist || node.music?.artist || "IndusTree";
      counts.set(artist, (counts.get(artist) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };

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
    const sideText = item.duration || item.date || (item.itFiles?.[0]?.name ?? "");
    const control = item.hasAudio
      ? `<button class="track-load" type="button" data-track-id="${escapeHtml(item.id)}" aria-label="Play ${escapeHtml(item.title)}">&gt;</button>`
      : `<span class="track-missing-mark" aria-hidden="true">${escapeHtml(item.hasIt ? "IT" : item.hasLyrics ? "Ly" : "-")}</span>`;
    return `<article class="mixtape-track${item.hasAudio ? "" : " is-missing"}${isActive ? " is-active" : ""}">
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

  const bottomPlayerHtml = () => {
    const item = musicState.currentId ? archive.musicItemsById[musicState.currentId] : null;
    if (!item?.hasAudio) {
      return "";
    }

    const duration = item.duration ? ` / ${item.duration}` : "";
    const source = item.audio?.source || "";
    const audio = source
      ? `<audio controls preload="metadata" src="${escapeHtml(source)}" data-mixtape-audio></audio>`
      : '<p class="missing-media">Audio is not restored for this archive entry yet.</p>';
    const download = source
      ? `<a href="${escapeHtml(item.audio.download || source)}" download>Download</a>`
      : `<a href="${routeHref(item.path)}">Open entry</a>`;
    return `<aside class="bottom-player" aria-label="Music player">
  <div class="bottom-player-inner">
    <div>
      <strong class="bottom-player-title">${escapeHtml(item.title)}</strong>
      <span class="bottom-player-meta">${escapeHtml(item.artist + duration)}</span>
    </div>
    ${audio}
    <div>${download}</div>
  </div>
</aside>`;
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
    setMeta("Music");
    app.innerHTML = `<section class="page music-page${musicState.currentId ? " has-player" : ""}">
  <div class="music-hero">
    <div>
      <h1>Music</h1>
      <p class="lede">Songs, lyrics, restored audio, and original Impulse Tracker files from the IndusTree orbit.</p>
    </div>
    <div class="music-stats" aria-label="Music archive stats">
      ${musicStatHtml("Audio", withAudio.length)}
      ${musicStatHtml("IT", withIt.length)}
      ${musicStatHtml("Lyrics", withLyrics.length)}
      ${musicStatHtml("Artists", artists.length)}
    </div>
  </div>
  <div class="music-tools">
    <label class="music-search">
      <span class="visually-hidden">Search music</span>
      <input type="search" value="${escapeHtml(musicState.query)}" placeholder="Search songs, artists, files..." data-music-search>
    </label>
    <div class="music-filter-row" aria-label="Song media">
      ${statusButtons.map(musicFilterHtml).join("\n")}
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
  ${bottomPlayerHtml()}
</section>`;
  };

  const renderSongPage = (item) => {
    setMeta(item.title, item.node?.excerpt || archive.site.description);
    app.innerHTML = songHtml(item);
    if (item.hasIt) mountCompactImpulsePlayer(item.itFiles[0]);
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
    const isMusicPage = path === "audio" || path === "music" || path === "lyrics" || path === "impulse";
    document.body.classList.toggle("has-mixtape-player", isMusicPage);
    if (window.__industreeImpulseStop) {
      try { window.__industreeImpulseStop(); } catch (_) {}
    }
    renderNav(path);

    if (!path) return renderHome();
    if (isMusicPage) {
      const defaultStatus = path === "impulse" ? "it" : path === "lyrics" ? "lyrics" : "all";
      applyMusicFilterHash(defaultStatus);
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
  };

  const renderNav = (currentPath = canonicalPath(currentRoutePath())) => {
    if (!nav) return;
    const currentNode = archive.nodes[String(archive.pathToNode[currentPath] || "")];
    const currentSong = archive.musicItemsByPath?.[currentPath];
    const items = archive.nav.map((item) => {
      const itemPath = canonicalPath(item.path);
      const active = itemPath === currentPath
        || (!itemPath && !currentPath)
        || (itemPath === "audio" && (
          !currentPath
          || currentPath === "music"
          || currentPath === "lyrics"
          || currentPath === "impulse"
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

  const selectTrack = (id, shouldPlay = true) => {
    const item = archive.musicItemsById[id];
    if (!item?.hasAudio) return;
    musicState.currentId = id;
    renderAudioList();
    const audio = app.querySelector("[data-mixtape-audio]");
    if (shouldPlay && item.audio?.source && audio) {
      audio.play().catch(() => {});
    }
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
      selectTrack(trackTrigger.dataset.trackId);
      return;
    }

    const link = event.target.closest("a[href]");
    if (!link || link.target || link.hasAttribute("download")) return;

    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/files/") || url.pathname.startsWith("/bobimages/")) return;
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
      document.querySelector(".brand")?.setAttribute("href", "/");
      document.querySelector(".brand img")?.setAttribute("src", archive.site.logo);
      document.querySelector(".brand img")?.setAttribute("alt", archive.site.name);
      const brandSlogan = document.querySelector(".brand em");
      if (brandSlogan) brandSlogan.textContent = archive.site.slogan;
      if (footer) footer.textContent = archive.site.footer;
      renderRoute();
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
