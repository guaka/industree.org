
(() => {
  const scriptUrl = new URL(document.currentScript.src);
  const assetBase = new URL(".", scriptUrl);
  const dataUrl = new URL("site-data.json", assetBase);
  const app = document.getElementById("app");
  const nav = document.querySelector("[data-nav]");
  const footer = document.querySelector("[data-footer]");
  let archive;
  const musicState = {
    artist: "all",
    query: "",
    status: "playable",
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
    return clean ? `/#/${clean}/` : "/#/";
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
      impulseRuntimePromise = loadScript(new URL("impulse-player.js?v=2", assetBase).toString());
    }
    return impulseRuntimePromise;
  };

  const impulseFileHref = (file) => `/#/impulse/${encodeURIComponent(file)}`;

  const mountImpulsePlayer = (initialFile, files, autoplay = false) => {
    ensureImpulseRuntime()
      .then(() => {
        window.initIndusTreeImpulsePlayer?.({
          mountId: "impulsePlayerMount",
          baseUrl: archive.impulse?.baseUrl,
          files,
          initialFile,
          autoplay,
          onFileSelect(file) {
            const next = impulseFileHref(file);
            if (location.hash !== next.slice(1)) {
              history.pushState({}, "", next);
            }
            const selected = files.find((entry) => entry.name === file);
            const download = document.querySelector("[data-impulse-download]");
            if (selected && download) {
              download.setAttribute("href", selected.url);
              download.textContent = `Download ${selected.name}`;
            }
          },
        });
      })
      .catch((error) => {
        console.error(error);
        const mount = document.getElementById("impulsePlayerMount");
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

  const artistCounts = (nodes) => {
    const counts = new Map();
    for (const node of nodes) {
      const artist = node.music?.artist || "IndusTree";
      counts.set(artist, (counts.get(artist) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };

  const nodeMatchesMusicState = (node) => {
    const music = node.music || {};
    if (musicState.status === "playable" && !music.playable) return false;
    if (musicState.status === "missing" && music.playable) return false;
    if (musicState.artist !== "all" && music.artistKey !== musicState.artist) return false;
    const query = musicState.query.trim().toLowerCase();
    if (query && !(music.searchText || "").includes(query)) return false;
    return true;
  };

  const trackRowHtml = (node) => {
    const music = node.music || {};
    const playable = Boolean(music.playable && node.audio?.source);
    const isActive = String(node.id) === String(musicState.currentId);
    const detail = routeHref(node.path);
    const artist = music.artist || "IndusTree";
    const duration = music.duration || "";
    const album = music.album ? ` / ${escapeHtml(music.album)}` : "";
    const status = playable ? "Playable" : "Missing audio";
    const control = playable
      ? `<button class="track-load" type="button" data-track-id="${escapeHtml(node.id)}" aria-label="Play ${escapeHtml(node.title)}">&gt;</button>`
      : '<span class="track-missing-mark" aria-hidden="true">-</span>';
    return `<article class="mixtape-track${playable ? "" : " is-missing"}${isActive ? " is-active" : ""}" data-track-id="${escapeHtml(node.id)}">
  ${control}
  <div class="track-main">
    <span class="track-title">${escapeHtml(node.title)}</span>
    <p class="track-meta">${escapeHtml(artist)}${album}</p>
  </div>
  <div class="track-side">
    <span>${escapeHtml(duration || node.date || "")}</span>
    <span class="track-status">${escapeHtml(status)}</span>
    <a class="track-detail" href="${detail}">Details</a>
  </div>
</article>`;
  };

  const bottomPlayerHtml = () => {
    const node = musicState.currentId ? archive.nodes[String(musicState.currentId)] : null;
    if (!node) {
      return "";
    }

    const music = node.music || {};
    const artist = music.artist || "IndusTree";
    const duration = music.duration ? ` / ${music.duration}` : "";
    const source = node.audio?.source || "";
    const audio = source
      ? `<audio controls preload="metadata" src="${escapeHtml(source)}" data-mixtape-audio></audio>`
      : '<p class="missing-media">Audio is not restored for this archive entry yet.</p>';
    const download = source
      ? `<a href="${escapeHtml(node.audio.download || source)}" download>Download</a>`
      : `<a href="${routeHref(node.path)}">Open entry</a>`;
    return `<aside class="bottom-player" aria-label="Music player">
  <div class="bottom-player-inner">
    <div>
      <strong class="bottom-player-title">${escapeHtml(node.title)}</strong>
      <span class="bottom-player-meta">${escapeHtml(artist + duration)}</span>
    </div>
    ${audio}
    <div>${download}</div>
  </div>
</aside>`;
  };

  const renderAudioList = () => {
    const nodes = (archive.lists.audio || [])
      .map((id) => archive.nodes[String(id)])
      .filter(Boolean);
    const playable = nodes.filter((node) => Boolean(node.audio?.source));
    const unavailable = nodes.filter((node) => !node.audio?.source);
    const filtered = nodes.filter(nodeMatchesMusicState);
    const artists = artistCounts(nodes);
    const artistKeys = new Map(nodes.map((node) => [
      node.music?.artist || "IndusTree",
      node.music?.artistKey || "industree",
    ]));
    const artistOptions = [
      ["All", "all", nodes.length],
      ...artists.map(([artist, count]) => [artist, artistKeys.get(artist), count]),
    ].filter(([, key]) => key);
    const statusButtons = [
      ["Playable", "playable", playable.length],
      ["All", "all", nodes.length],
      ["Missing audio", "missing", unavailable.length],
    ];
    setMeta("Music");
    app.innerHTML = `<section class="page music-page${musicState.currentId ? " has-player" : ""}">
  <div class="music-hero">
    <div>
      <h1>Music</h1>
      <p class="lede">Restored tracks and archive entries from the IndusTree orbit.</p>
    </div>
    <div class="music-stats" aria-label="Music archive stats">
      <span class="music-stat"><strong>${playable.length}</strong>Playable</span>
      <span class="music-stat"><strong>${unavailable.length}</strong>Missing</span>
      <span class="music-stat"><strong>${artists.length}</strong>Artists</span>
    </div>
  </div>
  <div class="music-tools">
    <label class="music-search">
      <span class="visually-hidden">Search music</span>
      <input type="search" value="${escapeHtml(musicState.query)}" placeholder="Search tracks, artists, years..." data-music-search>
    </label>
    <div class="music-filter-row" aria-label="Track status">
      ${statusButtons.map(([label, key, count]) => `<button class="music-filter" type="button" data-music-status="${escapeHtml(key)}" aria-pressed="${musicState.status === key}">${escapeHtml(label)} (${count})</button>`).join("\n")}
    </div>
    <label class="music-artist-select">
      <span class="visually-hidden">Artist</span>
      <select data-music-artist-select>
        ${artistOptions.map(([label, key, count]) => `<option value="${escapeHtml(key)}"${musicState.artist === key ? " selected" : ""}>${escapeHtml(label)} (${count})</option>`).join("\n")}
      </select>
    </label>
  </div>
  <section class="music-results" aria-labelledby="music-results-title">
    <div class="music-results-head">
      <h2 id="music-results-title">Tracks</h2>
      <span>${filtered.length} shown</span>
    </div>
    ${filtered.length ? filtered.map(trackRowHtml).join("\n") : '<p class="mixtape-empty">No tracks match these filters.</p>'}
  </section>
  ${bottomPlayerHtml()}
</section>`;
  };

  const renderImpulse = (path = "impulse") => {
    const impulse = archive.impulse || { files: [] };
    const files = impulse.files || [];
    const requestedFile = path.startsWith("impulse/")
      ? path.slice("impulse/".length).replace(/\/+$/g, "")
      : "";
    const first = files[0] || {
      name: "1-2sleepy.it",
      url: "https://audio.industree.org/itfiles/1-2sleepy.it",
    };
    const selected = files.find((file) => file.name === requestedFile) || first;
    const template = document.getElementById("impulse-player-template");
    const playerMarkup = template ? template.innerHTML : "";
    setMeta("Impulse");
    app.innerHTML = `<section class="page impulse-page">
  <div class="impulse-intro">
    <div>
      <h1>Impulse</h1>
      <p class="lede">Original Impulse Tracker files, playable in the browser with the Chasm IT player.</p>
    </div>
    <a class="button" href="${escapeHtml(selected.url)}" data-impulse-download>Download ${escapeHtml(selected.name)}</a>
  </div>
  <div class="impulse-player-mount" id="impulsePlayerMount">${playerMarkup}</div>
</section>`;
    mountImpulsePlayer(selected.name, files, Boolean(requestedFile));
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
  <p><a href="/#/">Return to the archive home</a></p>
</section>`;
  };

  const renderRoute = () => {
    const path = canonicalPath(currentRoutePath());
    const isMusicPage = path === "audio" || path === "music";
    const isImpulsePage = path === "impulse" || path.startsWith("impulse/");
    document.body.classList.toggle("has-mixtape-player", isMusicPage);
    if (!isImpulsePage && window.__industreeImpulseStop) {
      try { window.__industreeImpulseStop(); } catch (_) {}
    }
    renderNav(path);

    if (!path) return renderHome();
    if (isMusicPage) {
      return renderAudioList();
    }
    if (isImpulsePage) return renderImpulse(path);
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

  const renderNav = (currentPath = canonicalPath(currentRoutePath())) => {
    if (!nav) return;
    const currentNode = archive.nodes[String(archive.pathToNode[currentPath] || "")];
    const items = archive.nav.map((item) => {
      const itemPath = canonicalPath(item.path);
      const active = itemPath === currentPath
        || (!itemPath && !currentPath)
        || (itemPath === "audio" && (currentPath === "music" || currentPath.startsWith("audio/") || currentNode?.type === "audio"))
        || (itemPath === "impulse" && currentPath.startsWith("impulse/"));
      return `<li><a href="${routeHref(item.path)}"${active ? ' aria-current="page"' : ""}>${escapeHtml(item.title)}</a></li>`;
    });
    nav.innerHTML = `<ul>${items.join("\n")}</ul>`;
  };

  const selectTrack = (id, shouldPlay = true) => {
    const node = archive.nodes[String(id)];
    if (!node || node.type !== "audio") return;
    musicState.currentId = String(id);
    renderAudioList();
    const audio = app.querySelector("[data-mixtape-audio]");
    if (shouldPlay && node.audio?.source && audio) {
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
    renderAudioList();
  };

  const handleClick = (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const statusButton = event.target.closest("[data-music-status]");
    if (statusButton) {
      event.preventDefault();
      musicState.status = statusButton.dataset.musicStatus || "playable";
      renderAudioList();
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
    if (/\.[a-z0-9]{2,5}$/i.test(url.pathname) && !url.pathname.endsWith("/index.html")) return;

    event.preventDefault();
    if (url.hash.startsWith("#/")) {
      history.pushState({}, "", `/${url.hash}`);
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
      document.querySelector(".brand")?.setAttribute("href", "/#/");
      document.querySelector(".brand img")?.setAttribute("src", archive.site.logo);
      document.querySelector(".brand img")?.setAttribute("alt", archive.site.name);
      const brandName = document.querySelector(".brand strong");
      const brandSlogan = document.querySelector(".brand em");
      if (brandName) brandName.textContent = archive.site.name;
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
