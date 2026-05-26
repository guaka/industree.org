
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

  const renderAudioList = () => {
    const nodes = (archive.lists.audio || [])
      .map((id) => archive.nodes[String(id)])
      .filter(Boolean);
    const playable = nodes.filter((node) => Boolean(node.audio?.source));
    const unavailable = nodes.filter((node) => !node.audio?.source);
    setMeta("Music");
    app.innerHTML = `<section class="page">
  <h1>Music</h1>
  <p class="lede">${playable.length} playable tracks, plus ${unavailable.length} archive entries waiting for audio.</p>
  <section class="list-section" aria-labelledby="playable-audio">
    <h2 id="playable-audio">Playable now</h2>
    <div class="cards compact">${playable.map((node) => cardHtml(node, true)).join("\n")}</div>
  </section>
  ${unavailable.length ? `<section class="list-section" aria-labelledby="missing-audio">
    <h2 id="missing-audio">Archive entries without audio yet</h2>
    <div class="cards compact">${unavailable.map((node) => cardHtml(node, true)).join("\n")}</div>
  </section>` : ""}
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
  <p><a href="/#/">Return to the archive home</a></p>
</section>`;
  };

  const renderRoute = () => {
    const path = canonicalPath(currentRoutePath());
    renderNav(path);

    if (!path) return renderHome();
    if (path === "audio" || path === "music") {
      return renderAudioList();
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

  const renderNav = (currentPath = canonicalPath(currentRoutePath())) => {
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
