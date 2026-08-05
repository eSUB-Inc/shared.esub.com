/* eSUB Shared Admin SPA — React (UMD) + htm, no build step.
   Ported from the designs.esub.com Publishing Admin. */
(function () {
  "use strict";
  var CFG = window.ADMIN_CONFIG;
  var html = htm.bind(React.createElement);
  var useState = React.useState, useEffect = React.useEffect, useMemo = React.useMemo, useRef = React.useRef;

  function icon(name) { return html`<span class="material-icons-outlined">${name}</span>`; }
  // Theme: default to system; session override via data-theme on <html>.
  function getThemeOverride() { try { return sessionStorage.getItem("shared-admin-theme") || ""; } catch (e) { return ""; } }
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
  }
  function ThemeToggle(props) {
    var st = useState(getThemeOverride()); var override = st[0], setOverride = st[1];
    var sysDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var isDark = override ? override === "dark" : sysDark;
    function toggle() {
      var next = isDark ? "light" : "dark";
      try { sessionStorage.setItem("shared-admin-theme", next); } catch (e) {}
      applyTheme(next); setOverride(next);
    }
    return html`<button class="iconbtn themebtn ${props.floating ? "floating" : ""}" data-tip=${isDark ? "Switch to light mode" : "Switch to dark mode"} onClick=${toggle}>${icon(isDark ? "light_mode" : "dark_mode")}</button>`;
  }
  applyTheme(getThemeOverride());
  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  function claudePrompt(p) {
    return "Investigate a failed publish on shared.esub.com.\n" +
      "Page slug: " + p.slug + "\nAction: " + p.kind + "\nStarted: " + new Date(p.startedAt).toISOString() +
      "\nError: " + (p.error || "publish did not complete within the polling window") +
      "\n\nContext: eSUB-Inc/shared.esub.com-internal (private) holds internal/<slug>/index.html and access-codes.xlsx; " +
      "a GitHub Action runs publish.py to encrypt the page (AES-256-GCM) and push <slug>/content.enc plus a gate shell " +
      "to eSUB-Inc/shared.esub.com (public, GitHub Pages). Check the latest workflow run logs in shared.esub.com-internal, verify the " +
      "commit landed on main, confirm content.enc updated in the public repo, and confirm the page returns 200. " +
      "Propose a remediation.";
  }

  // Server-side sign-in log (proxy KV, 60-day retention). Success events carry
  // the user's token so the proxy records a verified identity; failure reports
  // are unauthenticated by nature and logged as "reported". Fire-and-forget —
  // logging must never block or break login itself.
  function reportLoginEvent(acct) {
    if (!(CFG.proxy && CFG.proxy.baseUrl)) return;
    var base = CFG.proxy.baseUrl.replace(/\/+$/, "");
    try {
      if (acct && window.AdminAuth.freshLogin) {
        window.AdminAuth.getApiToken().then(function (t) {
          return fetch(base + "/login-event", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
            body: JSON.stringify({ event: "login_success" }),
          });
        }).catch(function () {});
      } else if (window.AdminAuth.lastError) {
        fetch(base + "/login-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "login_failure", detail: window.AdminAuth.lastError }),
        }).catch(function () {});
      }
    } catch (e) {}
  }

  // Internal audit trail (localStorage) for security review.
  function audit(user, action, slug, detail) {
    try {
      var key = "shared-admin-audit";
      var log = JSON.parse(localStorage.getItem(key) || "[]");
      log.push({ ts: new Date().toISOString(), user: (user && (user.username || user.name)) || "unknown", action: action, slug: slug || "", detail: detail || "" });
      if (log.length > 1000) log = log.slice(log.length - 1000);
      localStorage.setItem(key, JSON.stringify(log));
    } catch (e) {}
  }

  // ---------- small shared pieces ----------
  function useToasts() {
    var st = useState([]); var toasts = st[0], setToasts = st[1];
    function dismiss(id) { setToasts(function (t) { return t.filter(function (x) { return x.id !== id; }); }); }
    function push(msg, kind) {
      var id = Date.now() + Math.random();
      setToasts(function (t) { return t.concat({ id: id, msg: msg, kind: kind }); });
      // Errors must be readable, not blink-and-miss: 12s + click-to-dismiss.
      setTimeout(function () { dismiss(id); }, kind === "error" ? 12000 : 3200);
    }
    return [toasts, push, dismiss];
  }
  function copyText(text, toast, label) {
    navigator.clipboard.writeText(text).then(function () { toast(label || "Copied to clipboard"); },
      function () { toast("Copy failed — clipboard unavailable"); });
  }
  function Toasts(props) {
    return html`<div class="toasts">${props.items.map(function (t) {
      return html`<div class="toast ${t.kind === "error" ? "err" : ""}" key=${t.id} onClick=${function () { props.onDismiss(t.id); }}>${t.msg}</div>`;
    })}</div>`;
  }
  // "Contact Help Desk" with the label as the link — the one affordance for
  // access requests and error escalation everywhere it appears.
  function HelpDesk(props) {
    return html`<span>Contact <a href=${CFG.helpDesk.url} target="_blank" rel="noopener">${CFG.helpDesk.label}</a>${props.suffix || ""}</span>`;
  }
  function Modal(props) {
    return html`<div class="scrim" onClick=${function (e) { if (e.target === e.currentTarget && props.onClose) props.onClose(); }}>
      <div class="modal ${props.wide ? "wide" : ""}" role="dialog" aria-modal="true">${props.children}</div>
    </div>`;
  }
  function fmtSize(bytes) {
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.ceil(bytes / 1024) + " KB";
  }
  function FilePicker(props) {
    var inputRef = useRef(null);
    var st = useState(null); var sizeErr = st[0], setSizeErr = st[1];
    var max = CFG.publishing.maxUploadBytes;
    function onPick(f) {
      if (f.size > max) {
        setSizeErr("“" + f.name + "” is " + fmtSize(f.size) + " — over the " + fmtSize(max) +
          " limit. Reduce the file's size (viewers decrypt the whole page in the browser, so heavy pages load slowly). If a larger page is genuinely needed, the limit can be raised in the app's config.");
        return;
      }
      setSizeErr(null);
      props.onFile(f);
    }
    return html`<div>
      <div class="filedrop ${props.file ? "on" : ""}" onClick=${function () { inputRef.current.click(); }}>
        ${props.file
          ? html`<span class="fname">${props.file.name}</span> — click to choose a different file`
          : "Click to choose a single HTML file (.html), up to " + fmtSize(max)}
      </div>
      <input ref=${inputRef} type="file" accept=".html,text/html" style=${{ display: "none" }}
        onChange=${function (e) { var f = e.target.files[0]; if (f) onPick(f); e.target.value = ""; }} />
      ${sizeErr && html`<p class="errline">${sizeErr}</p>`}
      <p class="hint">The file is published as <code>index.html</code> under the page's folder. It should be self-contained (inline assets) and no larger than ${fmtSize(max)}.</p>
    </div>`;
  }

  // ---------- login / PAT gate ----------
  function LoginScreen(props) {
    return html`<div class="login-wrap"><div class="card login-card">
      <p class="brand">e<span>SUB</span> Shared</p>
      <p class="tag">Publishing Admin</p>
      <button class="btn btn-primary ms-btn" onClick=${props.onLogin} disabled=${!props.configured}>
        ${icon("badge")} Sign in
      </button>
      ${!props.configured && html`<p class="hint" style=${{ marginTop: "12px" }}>Microsoft sign-in isn't configured in <code>config.js</code> yet.</p>`}
    </div></div>`;
  }

  function PatGate(props) {
    var st = useState(""); var pat = st[0], setPat = st[1];
    var st2 = useState(null); var err = st2[0], setErr = st2[1];
    var st3 = useState(false); var busy = st3[0], setBusy = st3[1];
    async function submit() {
      setBusy(true); setErr(null);
      try {
        window.GitHubApi.setToken(pat.trim());
        await window.GitHubApi.verifyToken();
        try { sessionStorage.setItem("shared-admin-pat", pat.trim()); } catch (e) {}
        props.onReady();
      } catch (e) { setErr("Token check failed: " + e.message); }
      setBusy(false);
    }
    return html`<div class="login-wrap"><div class="card login-card" style=${{ textAlign: "left" }}>
      <p class="brand" style=${{ textAlign: "center" }}>e<span>SUB</span> Shared</p>
      <p class="tag" style=${{ textAlign: "center" }}>GitHub Access</p>
      <p>Signed in as <strong>${props.user.name}</strong>. Paste the team publishing token (from the shared vault) to manage pages. It is kept only for this browser session.</p>
      <p class="hint">Token scopes, for reference: Contents read/write on <code>shared.esub.com-internal</code>, Contents read on <code>shared.esub.com</code>.</p>
      <label for="pat">Team publishing token</label>
      <input id="pat" type="password" value=${pat} onInput=${function (e) { setPat(e.target.value); }}
        onKeyDown=${function (e) { if (e.key === "Enter" && pat.trim()) submit(); }} autocomplete="off" />
      ${err && html`<p class="errline">${err}</p>`}
      <p class="hint" style=${{ marginTop: "10px" }}>Trouble with your token or repo access? <${HelpDesk} suffix="." /></p>
      <div class="actions" style=${{ marginTop: "18px", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
        <button class="btn btn-quiet" onClick=${props.onBack}>Back</button>
        <button class="btn btn-primary" disabled=${!pat.trim() || busy} onClick=${submit}>${busy ? "Checking…" : "Continue"}</button>
      </div>
    </div></div>`;
  }

  // ---------- row ----------
  function CodeCell(props) {
    var code = props.code;
    if (!code) return html`<span class="pgtitle">pending</span>`;
    return html`<div class="codecell">
      <span class="codeval">•••••••••••••</span>
      <button class="iconbtn" data-tip="Reveal code" onClick=${props.onReveal}>${icon("visibility")}</button>
      <button class="iconbtn" data-tip="Copy code" onClick=${function () { props.copy(code, "Code copied"); }}>${icon("content_copy")}</button>
    </div>`;
  }

  // Reveal in a dialog instead of inline: the full code is wider than the
  // masked dots and reflowed the whole table. Esc / X / outside click close.
  function CodeModal(props) {
    useEffect(function () {
      function onKey(e) { if (e.key === "Escape") { e.preventDefault(); props.onClose(); } }
      document.addEventListener("keydown", onKey, true);
      return function () { document.removeEventListener("keydown", onKey, true); };
    }, []);
    return html`<${Modal} onClose=${props.onClose}>
      <div class="modal-head">
        <h2>Access code — ${props.page.slug}</h2>
        <span style=${{ flex: 1 }}></span>
        <button class="iconbtn" data-tip="Copy code" onClick=${function () { props.copy(props.page.code, "Code copied"); }}>${icon("content_copy")}</button>
        <button class="iconbtn" data-tip="Close" onClick=${props.onClose}>${icon("close")}</button>
      </div>
      <div class="codereveal">${props.page.code}</div>
      <p class="keyhint">Esc or click outside to close</p>
    <//>`;
  }

  function StatusChip(props) {
    var p = props.pending;
    if (p && p.status === "publishing") return html`<span class="chip pending"><span class="spin" style=${{ width: "11px", height: "11px", borderWidth: "1.5px" }}></span>${p.kind === "archive" ? "Unpublishing" : p.kind === "delete" ? "Deleting" : "Publishing"}</span>`;
    if (p && p.status === "failed") return html`<span class="chip failed" onClick=${function () { props.onFail(p); }}>${icon("error_outline")}Failed — details</span>`;
    if (props.page.status === "archived") return html`<span class="chip archived">${icon("inventory_2")}Archived</span>`;
    if (!props.page.code) return html`<span class="chip pending"><span class="spin" style=${{ width: "11px", height: "11px", borderWidth: "1.5px" }}></span>Publishing</span>`;
    return html`<span class="chip published">${icon("check_circle")}Published</span>`;
  }

  function Row(props) {
    var pg = props.page, copy = props.copy, meta = props.meta, me = props.me;
    var archived = pg.status === "archived";
    var secure = pg.url + "#code=" + encodeURIComponent(pg.code || "");
    // Ownership line: a page shared WITH the viewer gets a SHARED badge + the
    // owner's name; an admin browsing someone else's page sees the owner name.
    var sharedToMe = meta && me && meta.owner !== me.email && (meta.sharedWith || []).indexOf(me.email) >= 0;
    var foreign = meta && me && meta.owner !== me.email && !sharedToMe;
    return html`<tr>
      <td class="favcell"><button class="iconbtn fav ${props.fav ? "on" : ""}" data-tip=${props.fav ? "Unfavorite" : "Favorite — pins to the top"}
        onClick=${function () { props.onFav(pg); }}>${icon(props.fav ? "star" : "star_border")}</button></td>
      <td><div class="pgname">${pg.slug}</div>${pg.title && html`<div class="pgtitle">${pg.title}</div>`}
        ${sharedToMe && html`<div class="pgowner"><span class="sharedchip">SHARED</span> ${meta.ownerName || meta.owner}</div>`}
        ${foreign && html`<div class="pgowner">${meta.ownerName || meta.owner}${(meta.sharedWith || []).length ? " · shared with " + meta.sharedWith.length : ""}</div>`}
      </td>
      <td><${StatusChip} page=${pg} pending=${props.pending} onFail=${props.onFail} /></td>
      <td class="notes ${archived ? "" : "notes-edit"}"
        title=${pg.notes ? pg.notes + (archived ? "" : "\n\n(click to edit)") : archived ? undefined : "Click to add notes"}
        onClick=${archived ? undefined : function () { props.onNotes(pg); }}>${pg.notes || "—"}${!archived && html`<span class="material-icons-outlined noteicon">edit</span>`}</td>
      <td><div class="urlcell">
        ${archived ? html`<span class="pgtitle">unpublished</span>` : html`<a href=${pg.url} target="_blank" rel="noopener">/${pg.slug}/</a>
        <button class="iconbtn" data-tip="Copy URL" onClick=${function () { copy(pg.url, "URL copied"); }}>${icon("content_copy")}</button>
        <button class="iconbtn" data-tip="Copy secure link (URL + code)" disabled=${!pg.code} onClick=${function () { copy(secure, "Secure link copied"); }}>${icon("enhanced_encryption")}</button>`}
      </div></td>
      <td>${archived ? html`<span class="pgtitle">—</span>` : html`<${CodeCell} code=${pg.code} copy=${copy} onReveal=${function () { props.onCode(pg); }} />`}</td>
      <td style=${{ whiteSpace: "nowrap" }}>${pg.sizeBytes != null ? fmtSize(pg.sizeBytes) : "—"}</td>
      <td style=${{ whiteSpace: "nowrap" }}>${fmtDate(pg.lastPublished)}</td>
      <td>${pg.publishedBy || "—"}</td>
      <td><div class="rowactions">
        ${!archived && html`<button class="iconbtn" data-tip="Update HTML" onClick=${function () { props.onUpdate(pg); }}>${icon("upload_file")}</button>
        <button class="iconbtn" data-tip="Reset access code" onClick=${function () { props.onReset(pg); }}>${icon("lock_reset")}</button>`}
        ${props.canShare && html`<button class="iconbtn" data-tip="Share (grant page admin)" onClick=${function () { props.onShare(pg); }}>${icon("share")}</button>`}
        ${!archived && html`<button class="iconbtn" data-tip="Archive (unpublish)" onClick=${function () { props.onArchive(pg); }}>${icon("inventory_2")}</button>`}
        ${archived && html`<button class="iconbtn" data-tip="Restore (republish, new code)" onClick=${function () { props.onRestore(pg); }}>${icon("restore")}</button>`}
        <button class="iconbtn danger" data-tip="Delete permanently" onClick=${function () { props.onDelete(pg); }}>${icon("delete_outline")}</button>
      </div></td>
    </tr>`;
  }

  // ---------- main screen ----------
  function effStatus(pg, pend) {
    if (pend && pend.status === "publishing") return pend.kind === "archive" ? "Unpublishing" : "Publishing";
    if (pend && pend.status === "failed") return "Failed";
    if (pg.status === "archived") return "Archived";
    return pg.code ? "Published" : "Publishing";
  }

  function Main(props) {
    var store = props.store, user = props.user, me = props.me;
    var isAdminUser = me && me.role === "admin";
    var proxyOn = window.ProxyApi.enabled();
    var s1 = useState([]); var pages = s1[0], setPages = s1[1];
    var s2 = useState(true); var loading = s2[0], setLoading = s2[1];
    var s3 = useState(""); var search = s3[0], setSearch = s3[1];
    var s4 = useState({ key: "name", dir: 1 }); var sort = s4[0], setSort = s4[1];
    var sf1 = useState([]); var byFilter = sf1[0], setByFilter = sf1[1];
    var sf2 = useState([]); var statusFilter = sf2[0], setStatusFilter = sf2[1];
    var sf3 = useState(null); var openFilter = sf3[0], setOpenFilter = sf3[1];
    var s5 = useState(1); var pageNum = s5[0], setPageNum = s5[1];
    var s6 = useState([]); var pending = s6[0], setPending = s6[1];
    var s7 = useState(null); var modal = s7[0], setModal = s7[1];
    var s8 = useState(null); var loadErr = s8[0], setLoadErr = s8[1];
    var s9 = useState({}); var pagesMeta = s9[0], setPagesMeta = s9[1]; // slug -> ownership record
    var s10 = useState("pages"); var view = s10[0], setView = s10[1];
    var s11 = useState([]); var favs = s11[0], setFavs = s11[1]; // starred slugs, pinned to the top
    var toastPair = useToasts(); var toasts = toastPair[0], toast = toastPair[1], dismissToast = toastPair[2];
    var copy = function (text, label) { copyText(text, toast, label); };
    var pendingRef = useRef(pending); pendingRef.current = pending;

    async function reload() {
      setLoading(true); setLoadErr(null);
      try {
        var results = await Promise.all([
          store.loadPages(),
          proxyOn ? window.ProxyApi.get("/pages").catch(function () { return []; }) : Promise.resolve([]),
        ]);
        setPages(results[0]);
        var meta = {};
        (results[1] || []).forEach(function (m) { if (m && m.slug) meta[m.slug] = m; });
        setPagesMeta(meta);
      }
      catch (e) { setLoadErr(e.message); }
      setLoading(false);
    }
    useEffect(function () { reload(); }, []);

    // Favorites: stored per-user through the proxy so they follow the user
    // across browsers; localStorage is the PAT-fallback home. Loaded once.
    useEffect(function () {
      if (proxyOn) {
        window.ProxyApi.get("/favorites").then(function (f) { setFavs(Array.isArray(f) ? f : []); }).catch(function () {});
      } else {
        try { setFavs(JSON.parse(localStorage.getItem("shared-admin-favs") || "[]")); } catch (e) {}
      }
    }, []);

    async function toggleFav(pg) {
      var has = favs.indexOf(pg.slug) >= 0;
      var next = has ? favs.filter(function (s) { return s !== pg.slug; }) : favs.concat(pg.slug);
      setFavs(next); // optimistic — the star responds instantly
      if (proxyOn) {
        try { await window.ProxyApi.post("/favorites", { set: next }); }
        catch (e) { setFavs(favs); toast("Could not save favorite: " + e.message, "error"); }
      } else {
        try { localStorage.setItem("shared-admin-favs", JSON.stringify(next)); } catch (e) {}
      }
    }

    // Poll pending publishes.
    useEffect(function () {
      var t = setInterval(async function () {
        var items = pendingRef.current.filter(function (p) { return p.status === "publishing"; });
        if (!items.length) return;
        for (var i = 0; i < items.length; i++) {
          var p = items[i];
          try {
            var takedown = p.kind === "archive" || p.kind === "delete";
            var done = takedown
              ? await store.checkUnpublished(p.slug)
              : await store.checkPublished(p.slug, p.prevEncSha);
            if (done) {
              var slug = p.slug;
              markPending(slug, { status: "published", completedAt: Date.now() });
              // Success cards fade (CSS) and are dropped a minute after completion.
              setTimeout(function () {
                setPending(function (list) { return list.filter(function (x) { return !(x.slug === slug && x.status === "published"); }); });
              }, 60000);
              await reload();
            } else if (Date.now() - p.startedAt > CFG.publishing.pollTimeoutMs) {
              markPending(p.slug, { status: "failed", error: (p.kind === "archive" ? "Unpublish" : p.kind === "delete" ? "Delete" : "Publish") + " did not complete within " + Math.round(CFG.publishing.pollTimeoutMs / 60000) + " minutes." });
            }
          } catch (e) {
            // Transient poll errors (rate limit, network blip) are retried on
            // the next tick; only the overall timeout fails the publish.
            if (Date.now() - p.startedAt > CFG.publishing.pollTimeoutMs) {
              markPending(p.slug, { status: "failed", error: e.message });
            }
          }
        }
      }, CFG.publishing.pollIntervalMs);
      return function () { clearInterval(t); };
    }, [store]);

    function markPending(slug, patch) {
      setPending(function (list) { return list.map(function (p) { return p.slug === slug ? Object.assign({}, p, patch) : p; }); });
    }
    function addPending(slug, kind, prevEncSha) {
      setPending(function (list) {
        return list.filter(function (p) { return p.slug !== slug; }).concat({ slug: slug, kind: kind, status: "publishing", startedAt: Date.now(), prevEncSha: prevEncSha || null });
      });
    }

    // ----- actions -----
    async function doUpload(name, file) {
      var slug = window.AdminData.slugify(name);
      var htmlText = await file.text();
      await store.uploadPage(slug, htmlText);
      audit(user, "upload", slug, "new page (" + file.name + ", " + htmlText.length + " bytes)");
      addPending(slug, "new page");
      setModal(null);
      toast("Submitted — publishing " + slug);
      reload();
    }
    async function doUpdate(pg, file) {
      var htmlText = await file.text();
      var prevSha = null;
      try { prevSha = await store.getEncSha(pg.slug); } catch (e) {}
      await store.updatePage(pg.slug, htmlText);
      audit(user, "update", pg.slug, "replaced html (" + file.name + ", " + htmlText.length + " bytes)");
      addPending(pg.slug, "update", prevSha);
      setModal(null);
      toast("Submitted — republishing " + pg.slug);
    }
    async function doReset(pg) {
      setModal(null);
      // Snapshot the ciphertext sha first: a reset re-encrypts the SAME page, so
      // "published" means the sha changed — existence + 200 are already true.
      var prevSha = null;
      try { prevSha = await store.getEncSha(pg.slug); } catch (e) {}
      try { await store.resetCode(pg.slug); }
      catch (e) { toast("Code reset failed: " + e.message, "error"); reload(); return; }
      audit(user, "reset-code", pg.slug);
      addPending(pg.slug, "code reset", prevSha);
      toast("Code reset submitted for " + pg.slug);
      reload();
    }
    async function doArchive(pg) {
      setModal(null);
      try { await store.archivePage(pg.slug); }
      catch (e) { toast("Archive failed: " + e.message, "error"); reload(); return; }
      audit(user, "archive", pg.slug);
      addPending(pg.slug, "archive");
      toast(pg.slug + " archived — unpublish in progress");
      reload();
    }
    async function doRestore(pg) {
      setModal(null);
      try { await store.restorePage(pg.slug); }
      catch (e) { toast("Restore failed: " + e.message, "error"); reload(); return; }
      audit(user, "restore", pg.slug);
      addPending(pg.slug, "restore");
      toast(pg.slug + " restoring — a new code will be minted");
      reload();
    }
    async function doDelete(pg) {
      setModal(null);
      try { await store.deletePage(pg.slug, pg.status); }
      catch (e) { toast("Delete failed: " + e.message, "error"); reload(); return; }
      audit(user, "delete", pg.slug, "was " + pg.status);
      // Archived pages are already off the public site; published ones need the
      // pipeline takedown tracked until the URL actually stops serving.
      if (pg.status !== "archived") addPending(pg.slug, "delete");
      toast(pg.slug + " deleted");
      reload();
    }

    var pendingBySlug = {};
    pending.forEach(function (p) { pendingBySlug[p.slug] = p; });

    async function doShare(pg, emails) {
      await window.ProxyApi.post("/page-share", { slug: pg.slug, set: emails });
      audit(user, "share", pg.slug, emails.join(","));
      setModal(null);
      toast("Sharing updated for " + pg.slug);
      reload();
    }

    async function doSaveNotes(pg, notes) {
      await store.saveNotes(pg.slug, notes);
      audit(user, "edit-notes", pg.slug, JSON.stringify({ from: pg.notes || "", to: notes }));
      setModal(null);
      toast("Notes saved for " + pg.slug);
      reload();
    }

    // ----- derived list -----
    // Standard users see only pages they own or that were shared with them
    // (plus their own just-submitted uploads, whose ownership record may still
    // be landing). Admins and the PAT fallback see everything.
    var scopedPages = useMemo(function () {
      if (isAdminUser || !proxyOn) return pages;
      return pages.filter(function (p) {
        var m = pagesMeta[p.slug];
        if (m && (m.owner === me.email || (m.sharedWith || []).indexOf(me.email) >= 0)) return true;
        return !!pendingBySlug[p.slug];
      });
    }, [pages, pagesMeta, pending, me]);

    var filtered = useMemo(function () {
      var q = search.trim().toLowerCase();
      var list = scopedPages.filter(function (p) {
        if (q && p.slug.indexOf(q) < 0 && (p.title || "").toLowerCase().indexOf(q) < 0) return false;
        if (byFilter.length && byFilter.indexOf(p.publishedBy || "—") < 0) return false;
        if (statusFilter.length && statusFilter.indexOf(effStatus(p, pendingBySlug[p.slug])) < 0) return false;
        return true;
      });
      var cmp = sort.key === "pub"
        ? function (a, b) { return ((a.lastPublished || "").localeCompare(b.lastPublished || "")) * sort.dir; }
        : function (a, b) { return a.slug.localeCompare(b.slug) * sort.dir; };
      // Favorites stay pinned above everything, whatever the active sort.
      var favSet = {};
      favs.forEach(function (s) { favSet[s] = 1; });
      return list.slice().sort(function (a, b) {
        var fa = favSet[a.slug] ? 0 : 1, fb = favSet[b.slug] ? 0 : 1;
        if (fa !== fb) return fa - fb;
        return cmp(a, b);
      });
    }, [scopedPages, search, sort, byFilter, statusFilter, pending, favs]);

    var pageSize = CFG.publishing.pageSize;
    var totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    var cur = Math.min(pageNum, totalPages);
    var visible = filtered.slice((cur - 1) * pageSize, cur * pageSize);
    useEffect(function () { setPageNum(1); }, [search, sort, byFilter, statusFilter]);

    function sortHeader(label, key) {
      var active = sort.key === key;
      return html`<th class="th-click" onClick=${function () { setSort(active ? { key: key, dir: -sort.dir } : { key: key, dir: key === "pub" ? -1 : 1 }); }}>
        ${label}<span class="tharrow">${active ? (sort.dir === 1 ? "\u2191" : "\u2193") : ""}</span>
      </th>`;
    }
    function filterHeader(label, id, options, selected, setSelected, counts) {
      function toggle(opt) {
        setSelected(selected.indexOf(opt) >= 0 ? selected.filter(function (x) { return x !== opt; }) : selected.concat(opt));
      }
      var open = openFilter && openFilter.id === id;
      return html`<th class="th-click ${selected.length ? "th-filtered" : ""}" onClick=${function (e) {
          if (open) { setOpenFilter(null); return; }
          var r = e.currentTarget.getBoundingClientRect();
          setOpenFilter({ id: id, x: r.left, y: r.bottom + 2 });
        }}>
        ${label}<span class="material-icons-outlined thfilter">filter_list</span>
        ${open && html`<div class="filter-pop" style=${{ left: openFilter.x + "px", top: openFilter.y + "px" }} onClick=${function (e) { e.stopPropagation(); }}>
          ${options.map(function (opt) {
            // An option that can't yield rows (given search + the other filter)
            // is dimmed and unclickable — unless it's already selected, so it
            // can still be unchecked. Recomputed every render, so it tracks
            // live status changes from the publish poller.
            var dead = !(counts && counts[opt] > 0) && selected.indexOf(opt) < 0;
            return html`<label key=${opt} class=${dead ? "dead" : ""}><input type="checkbox" disabled=${dead} checked=${selected.indexOf(opt) >= 0} onChange=${function () { toggle(opt); }} /> ${opt}</label>`;
          })}
          <button class="clearbtn" disabled=${!selected.length} onClick=${function () { setSelected([]); setOpenFilter(null); }}>Clear filter</button>
        </div>`}
      </th>`;
    }
    var byOptions = useMemo(function () {
      var s = {}; scopedPages.forEach(function (p) { s[p.publishedBy || "\u2014"] = 1; });
      return Object.keys(s).sort();
    }, [scopedPages]);
    var statusOptions = ["Published", "Publishing", "Unpublishing", "Archived", "Failed"];
    // Per-option row counts, each dimension judged against search + the OTHER
    // filter. Plain render-time computation so an open popover tracks status
    // transitions (Publishing -> Published etc.) as the poller updates state.
    var statusCounts = {}, byCounts = {};
    (function () {
      var q = search.trim().toLowerCase();
      scopedPages.forEach(function (p) {
        if (q && p.slug.indexOf(q) < 0 && (p.title || "").toLowerCase().indexOf(q) < 0) return;
        var st = effStatus(p, pendingBySlug[p.slug]);
        var by = p.publishedBy || "\u2014";
        if (!byFilter.length || byFilter.indexOf(by) >= 0) statusCounts[st] = (statusCounts[st] || 0) + 1;
        if (!statusFilter.length || statusFilter.indexOf(st) >= 0) byCounts[by] = (byCounts[by] || 0) + 1;
      });
    })();
    var strip = pending.filter(function (p) { return p.status !== "published" || Date.now() - (p.completedAt || p.startedAt) < 61000; });

    function failModal(p) { setModal({ kind: "fail", pending: p }); }

    return html`<div>
      <header class="hdr">
        <span class="brand">e<span>SUB</span> Shared</span>
        <span class="tag">Publishing Admin</span>
        <span class="spacer"></span>
        ${isAdminUser && proxyOn && html`<button class="hdrbtn ${view === "users" ? "on" : ""}" onClick=${function () { setView(view === "users" ? "pages" : "users"); }}>${icon("group")} Users</button>`}
        ${isAdminUser && proxyOn && html`<button class="iconbtn themebtn" data-tip="Sign-in activity" onClick=${function () { setModal({ kind: "activity" }); }}>${icon("monitoring")}</button>`}
        <${ThemeToggle} />
        <span class="user"><span class="avatar">${(user.firstName || "?").slice(0, 1).toUpperCase()}</span>${user.name}</span>
        <button class="signout" onClick=${props.onSignOut}>Sign out</button>
      </header>
      ${view === "users" && html`<${UsersView} me=${me} pages=${pages} pagesMeta=${pagesMeta} toast=${toast} onExit=${function () { setView("pages"); }} />`}
      <div class="wrap" style=${view === "users" ? { display: "none" } : undefined}>
        <div class="toolbar">
          <h1>Pages</h1>
          <span class="grow"></span>
          <div class="search">${icon("search")}<input placeholder="Filter by name…" value=${search} onInput=${function (e) { setSearch(e.target.value); }} /></div>
          <button class="btn btn-primary" onClick=${function () { setModal({ kind: "upload" }); }}>${icon("add")} Upload New Page</button>
        </div>

        ${strip.length > 0 && html`<div class="pending-strip">
          ${strip.map(function (p) {
            var pg = pages.find(function (x) { return x.slug === p.slug; });
            return html`<div class="card pending-card ${p.status === "published" ? "ok" : p.status === "failed" ? "err" : ""}" key=${p.slug}>
              ${p.status === "publishing" ? html`<span class="spin"></span>` : p.status === "published" ? html`<span class="check">${icon("check_circle")}</span>` : html`<span style=${{ color: "var(--red)" }}>${icon("error_outline")}</span>`}
              <div style=${{ flex: 1 }}>
                <div class="name">${p.slug} <span class="sub">· ${p.kind}</span></div>
                <div class="sub">${p.status === "publishing" ? (p.kind === "archive" || p.kind === "delete" ? "Waiting for the page to be taken down…" : "Waiting for the process to finish…")
                  : p.status === "published" ? (p.kind === "archive" ? "Unpublished — the page now returns 404" : p.kind === "delete" ? "Deleted — the page now returns 404" : "Live at " + CFG.site.baseUrl + "/" + p.slug + "/" + (pg && pg.code ? " · code ready" : ""))
                  : p.error}</div>
              </div>
              ${p.status === "failed" && html`<button class="btn btn-quiet" onClick=${function () { failModal(p); }}>Details</button>`}
              ${p.status === "published" && pg && pg.code && html`<button class="btn btn-quiet" onClick=${function () { copy(pg.url + "#code=" + encodeURIComponent(pg.code), "Secure link copied"); }}>${icon("enhanced_encryption")} Copy secure link</button>`}
            </div>`;
          })}
        </div>`}

        <div class="card">
          ${loadErr ? html`<div class="empty">Unable to load pages: ${loadErr}
            <div style=${{ marginTop: "8px", fontSize: "13px" }}><${HelpDesk} suffix=" if this keeps happening." /></div>
            <div style=${{ marginTop: "12px" }}><button class="btn btn-quiet" onClick=${reload}>Retry</button></div></div>`
          : loading ? html`<div class="empty">Loading pages…</div>`
          : visible.length === 0 ? html`<div class="empty">
              ${search || byFilter.length || statusFilter.length
                ? html`No pages match the current ${search ? "search" : "filters"}.
                  <div style=${{ marginTop: "12px" }}><button class="btn btn-quiet" onClick=${function () { setSearch(""); setByFilter([]); setStatusFilter([]); setOpenFilter(null); }}>Clear search & filters</button></div>`
                : "No pages yet. Upload the first one."}
            </div>`
          : html`<div class="tablewrap"><table>
            <thead><tr><th class="favcell"></th>${sortHeader("Page", "name")}${filterHeader("Status", "status", statusOptions, statusFilter, setStatusFilter, statusCounts)}<th>Notes</th><th>Public URL</th><th>Access Code</th><th>Size</th>${sortHeader("Last Published", "pub")}${filterHeader("By", "by", byOptions, byFilter, setByFilter, byCounts)}<th style=${{ textAlign: "right" }}>Actions</th></tr></thead>
            <tbody>
              ${visible.map(function (pg) {
                var m = pagesMeta[pg.slug];
                return html`<${Row} key=${pg.slug + pg.status} page=${pg} pending=${pendingBySlug[pg.slug]} copy=${copy} onFail=${failModal}
                  meta=${m} me=${me}
                  fav=${favs.indexOf(pg.slug) >= 0} onFav=${toggleFav}
                  canShare=${proxyOn && m && (isAdminUser || m.owner === me.email)}
                  onShare=${function (p) { setModal({ kind: "share", page: p, meta: pagesMeta[p.slug] }); }}
                  onCode=${function (p) { setModal({ kind: "code", page: p }); }}
                  onNotes=${function (p) { setModal({ kind: "notes", page: p }); }}
                  onUpdate=${function (p) { setModal({ kind: "update", page: p }); }}
                  onReset=${function (p) { setModal({ kind: "reset", page: p }); }}
                  onArchive=${function (p) { setModal({ kind: "archive", page: p }); }}
                  onRestore=${function (p) { setModal({ kind: "restore", page: p }); }}
                  onDelete=${function (p) { setModal({ kind: "delete", page: p }); }} />`;
              })}
            </tbody>
          </table></div>
          ${totalPages > 1 && html`<div class="pager">
            <span class="count">${filtered.length} pages</span>
            <button disabled=${cur === 1} onClick=${function () { setPageNum(cur - 1); }}>‹</button>
            ${Array.from({ length: totalPages }, function (_, i) {
              return html`<button key=${i} class=${cur === i + 1 ? "cur" : ""} onClick=${function () { setPageNum(i + 1); }}>${i + 1}</button>`;
            })}
            <button disabled=${cur === totalPages} onClick=${function () { setPageNum(cur + 1); }}>›</button>
          </div>`}`}
        </div>
      </div>
      ${openFilter && html`<div style=${{ position: "fixed", inset: 0, zIndex: 5 }} onClick=${function () { setOpenFilter(null); }}></div>`}

      ${modal && modal.kind === "upload" && html`<${UploadModal} onClose=${function () { setModal(null); }} onSubmit=${doUpload} existing=${pages.map(function (p) { return p.slug; })} />`}
      ${modal && modal.kind === "update" && html`<${UpdateModal} page=${modal.page} onClose=${function () { setModal(null); }} onSubmit=${doUpdate} />`}
      ${modal && modal.kind === "reset" && html`<${ConfirmModal} title="Reset access code" danger=${false} confirmLabel="Reset Code"
        body=${"A new code will be generated for “" + modal.page.slug + "” and the page re-encrypted. The current code — and every link already shared with it — stops working."}
        onClose=${function () { setModal(null); }} onConfirm=${function () { doReset(modal.page); }} />`}
      ${modal && modal.kind === "archive" && html`<${ConfirmModal} title="Archive page" danger=${false} confirmLabel="Archive"
        body=${"“" + modal.page.slug + "” will be unpublished from shared.esub.com but its source is kept and it can be restored later. Restoring mints a new access code; notes and title are not retained (the registry row is removed)."}
        onClose=${function () { setModal(null); }} onConfirm=${function () { doArchive(modal.page); }} />`}
      ${modal && modal.kind === "delete" && html`<${ConfirmModal} title="Delete page" danger=${true} confirmLabel="Delete Permanently"
        body=${"“" + modal.page.slug + "” will be removed from the site, its source deleted, and its access-code row dropped. This cannot be undone from the admin."}
        onClose=${function () { setModal(null); }} onConfirm=${function () { doDelete(modal.page); }} />`}
      ${modal && modal.kind === "restore" && html`<${ConfirmModal} title="Restore page" danger=${false} confirmLabel="Restore"
        body=${"“" + modal.page.slug + "” will be republished at " + CFG.site.baseUrl + "/" + modal.page.slug + "/ with a newly minted access code (the pre-archive code was retired). Share the new secure link once it is live."}
        onClose=${function () { setModal(null); }} onConfirm=${function () { doRestore(modal.page); }} />`}
      ${modal && modal.kind === "code" && html`<${CodeModal} page=${modal.page} copy=${copy} onClose=${function () { setModal(null); }} />`}
      ${modal && modal.kind === "notes" && html`<${NotesModal} page=${modal.page} onClose=${function () { setModal(null); }} onSave=${doSaveNotes} />`}
      ${modal && modal.kind === "fail" && html`<${FailModal} pending=${modal.pending} copy=${copy} onClose=${function () { setModal(null); }} />`}
      ${modal && modal.kind === "activity" && html`<${ActivityModal} onClose=${function () { setModal(null); }} />`}
      ${modal && modal.kind === "share" && html`<${ShareModal} page=${modal.page} meta=${modal.meta} me=${me} onClose=${function () { setModal(null); }} onSave=${doShare} />`}
      <${Toasts} items=${toasts} onDismiss=${dismissToast} />
    </div>`;
  }

  // ---------- modals ----------
  function UploadModal(props) {
    var s1 = useState(""); var name = s1[0], setName = s1[1];
    var s2 = useState(null); var file = s2[0], setFile = s2[1];
    var s3 = useState(false); var busy = s3[0], setBusy = s3[1];
    var s4 = useState(null); var err = s4[0], setErr = s4[1];
    var slug = window.AdminData.slugify(name);
    var collision = slug && props.existing.indexOf(slug) >= 0;
    async function submit() {
      setBusy(true); setErr(null);
      try { await props.onSubmit(name, file); }
      catch (e) { setErr(e.message); setBusy(false); }
    }
    return html`<${Modal} onClose=${props.onClose}>
      <h2>Upload New Page</h2>
      <p class="sub">The page is committed to the private repo; a GitHub workflow encrypts it, mints a 4-word access code, and publishes it.</p>
      <label>Page name</label>
      <input type="text" value=${name} placeholder="e.g. Budget Redesign" onInput=${function (e) { setName(e.target.value); }} />
      ${slug && html`<p class="hint">URL: <code>${CFG.site.baseUrl}/${slug}/</code>${collision ? html` — <span style=${{ color: "var(--red)", fontWeight: 700 }}>a page with this name already exists</span>` : ""}</p>`}
      <label>HTML file</label>
      <${FilePicker} file=${file} onFile=${setFile} />
      ${err && html`<p class="errline">${err}</p>`}
      <div class="actions">
        <button class="btn btn-quiet" onClick=${props.onClose}>Cancel</button>
        <button class="btn btn-primary" disabled=${!slug || !file || collision || busy} onClick=${submit}>${busy ? "Submitting…" : "Submit"}</button>
      </div>
    <//>`;
  }

  function UpdateModal(props) {
    var s1 = useState(null); var file = s1[0], setFile = s1[1];
    var s2 = useState(false); var busy = s2[0], setBusy = s2[1];
    var s3 = useState(null); var err = s3[0], setErr = s3[1];
    async function submit() {
      setBusy(true); setErr(null);
      try { await props.onSubmit(props.page, file); }
      catch (e) { setErr(e.message); setBusy(false); }
    }
    return html`<${Modal} onClose=${props.onClose}>
      <h2>Update “${props.page.slug}”</h2>
      <p class="sub">Upload a replacement HTML file. It is saved as <code>index.html</code>, re-encrypted, and republished. The access code and URL stay the same.</p>
      <${FilePicker} file=${file} onFile=${setFile} />
      ${err && html`<p class="errline">${err}</p>`}
      <div class="actions">
        <button class="btn btn-quiet" onClick=${props.onClose}>Cancel</button>
        <button class="btn btn-primary" disabled=${!file || busy} onClick=${submit}>${busy ? "Submitting…" : "Save & Republish"}</button>
      </div>
    <//>`;
  }

  function ConfirmModal(props) {
    return html`<${Modal} onClose=${props.onClose}>
      <h2>${props.title}</h2>
      <p class="sub" style=${{ marginTop: "8px" }}>${props.body}</p>
      <div class="actions">
        <button class="btn btn-quiet" onClick=${props.onClose}>Cancel</button>
        <button class=${"btn " + (props.danger ? "btn-danger" : "btn-primary")} onClick=${props.onConfirm}>${props.confirmLabel}</button>
      </div>
    <//>`;
  }

  function NotesModal(props) {
    var orig = props.page.notes || "";
    var s1 = useState(orig); var val = s1[0], setVal = s1[1];
    var s2 = useState(false); var confirmOpen = s2[0], setConfirmOpen = s2[1];
    var s3 = useState(false); var busy = s3[0], setBusy = s3[1];
    var s4 = useState(null); var err = s4[0], setErr = s4[1];
    var dirty = val !== orig;
    var ref = useRef(); ref.current = { dirty: dirty, confirmOpen: confirmOpen, busy: busy, save: save, attemptClose: attemptClose };
    function attemptClose() { if (ref.current.dirty) setConfirmOpen(true); else props.onClose(); }
    useEffect(function () {
      function onKey(e) {
        var isEnter = e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter" || e.keyCode === 13;
        if (e.key === "Escape") {
          e.preventDefault();
          if (ref.current.confirmOpen) setConfirmOpen(false); else ref.current.attemptClose();
        } else if (isEnter && (e.altKey || e.ctrlKey || e.metaKey || (e.getModifierState && e.getModifierState("Alt")))) {
          e.preventDefault();
          if (ref.current.dirty && !ref.current.busy && !ref.current.confirmOpen) ref.current.save();
        }
      }
      document.addEventListener("keydown", onKey, true);
      return function () { document.removeEventListener("keydown", onKey, true); };
    }, []);
    async function save() {
      setBusy(true); setErr(null);
      try { await props.onSave(props.page, val); }
      catch (e) { setErr(e.message); setBusy(false); }
    }
    return html`<${Modal} onClose=${attemptClose}>
      <div class="modal-head">
        <h2>Notes — ${props.page.slug}</h2>
        <span style=${{ flex: 1 }}></span>
        <button class="iconbtn" data-tip="Save" disabled=${!dirty || busy} onClick=${save}>${icon("save")}</button>
        <button class="iconbtn" data-tip="Close" onClick=${attemptClose}>${icon("close")}</button>
      </div>
      <textarea class="notes-area" value=${val} placeholder="Add notes about this page…" autoFocus=${true}
        onInput=${function (e) { setVal(e.target.value); }}></textarea>
      ${err && html`<p class="errline">${err}</p>`}
      ${busy && html`<p class="hint">Saving…</p>`}
      <p class="keyhint">Cmd+Enter or Ctrl+Enter to save · Esc to close</p>
      ${confirmOpen && html`<div class="scrim" style=${{ zIndex: 120 }}>
        <div class="modal" style=${{ maxWidth: "380px" }}>
          <h2>Discard changes?</h2>
          <p class="sub" style=${{ marginTop: "8px" }}>Changes to the notes will be lost. Do you want to continue?</p>
          <div class="actions">
            <button class="btn btn-quiet" autoFocus=${true} onClick=${function () { setConfirmOpen(false); }}>No</button>
            <button class="btn btn-danger" onClick=${props.onClose}>Yes, Discard</button>
          </div>
        </div>
      </div>`}
    <//>`;
  }

  // Share a page: the owner (or an admin) grants other signed-in users full
  // control of the page — it appears in their list with a SHARED badge.
  function ShareModal(props) {
    var meta = props.meta || {};
    var s1 = useState(null); var people = s1[0], setPeople = s1[1];
    var s2 = useState((meta.sharedWith || []).slice()); var sel = s2[0], setSel = s2[1];
    var s3 = useState(null); var err = s3[0], setErr = s3[1];
    var s4 = useState(false); var busy = s4[0], setBusy = s4[1];
    useEffect(function () {
      window.ProxyApi.get("/people")
        .then(function (list) { setPeople(list.filter(function (p) { return p.email !== meta.owner; })); })
        .catch(function (e) { setErr(e.message); });
    }, []);
    function toggle(email) {
      setSel(sel.indexOf(email) >= 0 ? sel.filter(function (x) { return x !== email; }) : sel.concat(email));
    }
    async function save() {
      setBusy(true); setErr(null);
      try { await props.onSave(props.page, sel); }
      catch (e) { setErr(e.message); setBusy(false); }
    }
    return html`<${Modal} onClose=${props.onClose}>
      <h2>Share “${props.page.slug}”</h2>
      <p class="sub">People you share with get full admin control of this page — it appears in their list marked <strong>SHARED</strong> with ${meta.owner === props.me.email ? "your" : "the owner's"} name. Only people who have signed in to this admin at least once can be selected.</p>
      ${err && html`<p class="errline">${err}</p>`}
      ${people == null ? html`<div class="empty">Loading people…</div>`
      : people.length === 0 ? html`<div class="empty">No one else has signed in yet — there is nobody to share with.</div>`
      : html`<div class="sharelist">${people.map(function (p) {
          return html`<label key=${p.email}><input type="checkbox" checked=${sel.indexOf(p.email) >= 0} onChange=${function () { toggle(p.email); }} /> ${p.name} <span class="pgtitle">${p.email}</span></label>`;
        })}</div>`}
      <div class="actions">
        <button class="btn btn-quiet" onClick=${props.onClose}>Cancel</button>
        <button class="btn btn-primary" disabled=${busy || people == null} onClick=${save}>${busy ? "Saving…" : "Save Sharing"}</button>
      </div>
    <//>`;
  }

  // ---------- Users (admin only) ----------
  var ACTION_LABELS = {
    publish: { text: "Published", ic: "publish" }, revise: { text: "Revised", ic: "upload_file" },
    archive: { text: "Archived", ic: "inventory_2" }, restore: { text: "Restored", ic: "restore" },
    "delete": { text: "Deleted", ic: "delete_outline" }, "reset-code": { text: "Reset code", ic: "lock_reset" },
    "edit-notes": { text: "Edited notes", ic: "edit" }, share: { text: "Shared", ic: "share" },
  };

  function RoleChip(props) {
    var u = props.user;
    if (u.roleLocked) {
      return html`<span class="chip published rolechip locked" data-tip="Bootstrap admin (ADMIN_EMAILS) — role is fixed">${icon("verified_user")}admin</span>`;
    }
    // Click toggles the role in place (admin <-> standard).
    return html`<span class="chip ${u.role === "admin" ? "published" : "archived"} rolechip" data-tip="Click to make ${u.role === "admin" ? "standard" : "admin"}"
      onClick=${function (e) { e.stopPropagation(); props.onToggle(u); }}>${icon(u.role === "admin" ? "verified_user" : "person")}${u.role}</span>`;
  }

  function UsersView(props) {
    var me = props.me, pagesMeta = props.pagesMeta, toast = props.toast;
    var s1 = useState(null); var users = s1[0], setUsers = s1[1];
    var s2 = useState(null); var err = s2[0], setErr = s2[1];
    var s3 = useState(""); var q = s3[0], setQ = s3[1];
    var s4 = useState(0); var selIdx = s4[0], setSelIdx = s4[1];
    var s5 = useState(null); var detail = s5[0], setDetail = s5[1];
    var s6 = useState(null); var activity = s6[0], setActivity = s6[1];
    var s7 = useState(null); var confirm = s7[0], setConfirm = s7[1];
    var searchRef = useRef(null);

    // Live page status by slug (from the already-loaded pages list) so counts
    // reflect what is actually on the site right now.
    var statusBySlug = {};
    (props.pages || []).forEach(function (p) { statusBySlug[p.slug] = p.status; });

    function statsFor(u) {
      var owned = Object.keys(pagesMeta).map(function (k) { return pagesMeta[k]; })
        .filter(function (m) { return m.owner === u.email; });
      var active = owned.filter(function (m) { return statusBySlug[m.slug] && statusBySlug[m.slug] !== "archived"; });
      var sharedOut = owned.filter(function (m) { return (m.sharedWith || []).length > 0; });
      return { owned: owned, active: active.length, sharedOut: sharedOut.length };
    }

    async function load() {
      setErr(null);
      try { setUsers(await window.ProxyApi.get("/users")); }
      catch (e) { setErr(e.message); }
    }
    useEffect(function () { load(); }, []);

    var list = (users || []).filter(function (u) {
      var needle = q.trim().toLowerCase();
      if (!needle) return true;
      return (u.name || "").toLowerCase().indexOf(needle) >= 0 || (u.email || "").toLowerCase().indexOf(needle) >= 0;
    }).sort(function (a, b) { return (a.name || a.email).localeCompare(b.name || b.email); });

    function openDetail(u) {
      setDetail(u); setActivity(null);
      window.ProxyApi.get("/activity?days=60&user=" + encodeURIComponent(u.email))
        .then(setActivity)
        .catch(function (e) { setActivity({ error: e.message }); });
    }

    async function toggleRole(u) {
      var next = u.role === "admin" ? "standard" : "admin";
      try {
        await window.ProxyApi.post("/user-role", { email: u.email, role: next });
        toast(u.name + " is now " + next);
        setUsers(users.map(function (x) { return x.email === u.email ? Object.assign({}, x, { role: next }) : x; }));
        if (detail && detail.email === u.email) setDetail(Object.assign({}, detail, { role: next }));
      } catch (e) { toast("Role change failed: " + e.message, "error"); }
    }

    async function setDisabled(u, disabled) {
      setConfirm(null);
      try {
        await window.ProxyApi.post("/user-status", { email: u.email, disabled: disabled });
        toast(u.name + (disabled ? " disabled — they'll be told to open a Help Desk ticket" : " re-enabled"));
        setUsers(users.map(function (x) { return x.email === u.email ? Object.assign({}, x, { disabled: disabled }) : x; }));
        if (detail && detail.email === u.email) setDetail(Object.assign({}, detail, { disabled: disabled }));
      } catch (e) { toast("Update failed: " + e.message, "error"); }
    }

    // Keyboard shortcuts: / focuses search, arrows move the highlight, Enter
    // opens the highlighted user, Esc backs out (detail -> list -> Pages).
    var kbRef = useRef();
    kbRef.current = { list: list, selIdx: selIdx, detail: detail, confirm: confirm };
    useEffect(function () {
      function onKey(e) {
        var st = kbRef.current;
        var typing = e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");
        if (e.key === "Escape") {
          if (st.confirm) return; // the confirm modal handles its own Esc
          e.preventDefault();
          if (typing) { e.target.blur(); return; }
          if (st.detail) { setDetail(null); setActivity(null); } else props.onExit();
          return;
        }
        if (typing) return;
        if (e.key === "/") { e.preventDefault(); if (searchRef.current) searchRef.current.focus(); return; }
        if (st.detail) return;
        if (e.key === "ArrowDown") { e.preventDefault(); setSelIdx(Math.min(st.selIdx + 1, st.list.length - 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setSelIdx(Math.max(st.selIdx - 1, 0)); }
        else if (e.key === "Enter" && st.list[st.selIdx]) { e.preventDefault(); openDetail(st.list[st.selIdx]); }
      }
      document.addEventListener("keydown", onKey);
      return function () { document.removeEventListener("keydown", onKey); };
    }, []);
    useEffect(function () { setSelIdx(0); }, [q, users]);

    function fmtEvt(e) {
      var map = { login_success: "Signed in", login_failure: "Failed sign-in", unauthorized_api: "Unauthorized call", disabled_login: "Attempted while disabled", account_disabled_by_admin: "Account disabled", account_enabled_by_admin: "Account enabled", role_changed: "Role changed" };
      return map[e.type] || e.type;
    }

    var body;
    if (err) body = html`<div class="card"><div class="empty">Unable to load users: ${err}<div style=${{ marginTop: "12px" }}><button class="btn btn-quiet" onClick=${load}>Retry</button></div></div></div>`;
    else if (users == null) body = html`<div class="card"><div class="empty">Loading users…</div></div>`;
    else if (detail) {
      var st = statsFor(detail);
      body = html`<div>
        <button class="btn btn-quiet" onClick=${function () { setDetail(null); setActivity(null); }}>${icon("arrow_back")} All users</button>
        <div class="card userdetail">
          <div class="userdetail-head">
            <span class="avatar big">${(detail.firstName || detail.email).slice(0, 1).toUpperCase()}</span>
            <div style=${{ flex: 1 }}>
              <h2 style=${{ margin: 0 }}>${detail.firstName} ${detail.lastName}</h2>
              <div class="pgtitle">${detail.email}</div>
              <div style=${{ marginTop: "6px", display: "flex", gap: "8px", alignItems: "center" }}>
                <${RoleChip} user=${detail} onToggle=${toggleRole} />
                ${detail.disabled ? html`<span class="chip failed">${icon("block")}Disabled</span>` : html`<span class="chip published">${icon("check_circle")}Active</span>`}
              </div>
            </div>
            ${detail.disabled
              ? html`<button class="btn btn-primary" onClick=${function () { setDisabled(detail, false); }}>Enable account</button>`
              : html`<button class="btn btn-danger" disabled=${detail.roleLocked} onClick=${function () { setConfirm(detail); }}>Disable account</button>`}
          </div>
          <div class="userdetail-cols">
            <div>
              <h3>Details</h3>
              <p class="sub">First signed in ${fmtDate(detail.firstSeen)}<br/>Last seen ${fmtDate(detail.lastSeen)}<br/>${st.active} active page(s) · ${st.owned.length} owned total · ${st.sharedOut} shared out</p>
              <h3>Pages</h3>
              ${st.owned.length === 0 ? html`<p class="sub">No pages created through the admin.</p>`
              : html`<ul class="userpages">${st.owned.map(function (m) {
                  var live = statusBySlug[m.slug];
                  return html`<li key=${m.slug}><span class="pgname">${m.slug}</span>
                    <span class="pgtitle">${live ? (live === "archived" ? "archived" : "active") : "deleted"}${(m.sharedWith || []).length ? " · shared with " + m.sharedWith.join(", ") : ""}</span></li>`;
                })}</ul>`}
            </div>
            <div>
              <h3>Activity — last 60 days</h3>
              ${activity == null ? html`<p class="sub">Loading…</p>`
              : activity.error ? html`<p class="errline">${activity.error}</p>`
              : html`<div class="acttimeline">
                  ${(activity.actions || []).length === 0 && (activity.logins || []).length === 0 && html`<p class="sub">No recorded activity.</p>`}
                  ${(activity.actions || []).map(function (x, i) {
                    var l = ACTION_LABELS[x.kind] || { text: x.kind, ic: "bolt" };
                    return html`<div class="actrow" key=${"a" + i}>${icon(l.ic)}<span>${l.text} <strong>${x.slug}</strong></span><span class="pgtitle">${fmtDate(x.ts)}</span></div>`;
                  })}
                  ${(activity.logins || []).map(function (x, i) {
                    return html`<div class="actrow muted" key=${"l" + i}>${icon("login")}<span>${fmtEvt(x)}</span><span class="pgtitle">${fmtDate(x.ts)} · ${x.ip || ""}</span></div>`;
                  })}
                </div>`}
            </div>
          </div>
        </div>
      </div>`;
    } else {
      body = html`<div class="card">
        ${list.length === 0 ? html`<div class="empty">No users match.</div>`
        : html`<div class="tablewrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active Pages</th><th>Shared</th><th>Last Sign-in</th><th>Status</th></tr></thead>
          <tbody>${list.map(function (u, i) {
            var st = statsFor(u);
            return html`<tr key=${u.email} class="userrow ${i === selIdx ? "kbd-sel" : ""}" onClick=${function () { setSelIdx(i); openDetail(u); }}>
              <td><div class="pgname">${u.firstName} ${u.lastName}</div></td>
              <td>${u.email}</td>
              <td><${RoleChip} user=${u} onToggle=${toggleRole} /></td>
              <td>${st.active}</td>
              <td>${st.sharedOut}</td>
              <td style=${{ whiteSpace: "nowrap" }}>${fmtDate(u.lastSeen)}</td>
              <td>${u.disabled ? html`<span class="chip failed">${icon("block")}Disabled</span>` : html`<span class="chip published">${icon("check_circle")}Active</span>`}</td>
            </tr>`;
          })}</tbody>
        </table></div>`}
      </div>`;
    }

    return html`<div class="wrap">
      <div class="toolbar">
        <h1>Users</h1>
        <span class="grow"></span>
        ${!detail && html`<div class="search">${icon("search")}<input ref=${searchRef} placeholder="Filter users…" value=${q} onInput=${function (e) { setQ(e.target.value); }} /></div>`}
      </div>
      ${body}
      <p class="kbdhint">${detail ? "Esc back to the user list" : "↑ ↓ select · Enter open · / search · Esc back to Pages"}</p>
      ${confirm && html`<${ConfirmModal} title="Disable account" danger=${true} confirmLabel="Disable Account"
        body=${confirm.name + " will be blocked from the Publishing Admin. On their next sign-in they'll see a message that their account has been disabled and to open an eSUB Help Desk ticket to restore access. Their pages stay live and owned by them."}
        onClose=${function () { setConfirm(null); }} onConfirm=${function () { setDisabled(confirm, true); }} />`}
    </div>`;
  }

  // Sign-in activity monitor: the proxy's KV event log (60-day retention).
  // Entra ID's sign-in logs stay the authoritative record; this is the
  // self-serve view of what reached OUR proxy.
  function ActivityModal(props) {
    var s1 = useState(null); var rows = s1[0], setRows = s1[1];
    var s2 = useState(null); var err = s2[0], setErr = s2[1];
    useEffect(function () {
      (async function () {
        try {
          var t = await window.AdminAuth.getApiToken();
          var res = await fetch(CFG.proxy.baseUrl.replace(/\/+$/, "") + "/logins?days=60", {
            headers: { Authorization: "Bearer " + t },
          });
          if (!res.ok) throw new Error("HTTP " + res.status);
          setRows(await res.json());
        } catch (e) { setErr(e.message); }
      })();
    }, []);
    var labels = {
      login_success: { text: "Sign-in", cls: "published", ic: "check_circle" },
      login_failure: { text: "Failed sign-in", cls: "failed", ic: "error_outline" },
      unauthorized_api: { text: "Unauthorized call", cls: "failed", ic: "gpp_bad" },
    };
    return html`<${Modal} wide=${true} onClose=${props.onClose}>
      <div class="modal-head">
        <h2>Sign-in activity — last 60 days</h2>
        <span style=${{ flex: 1 }}></span>
        <button class="iconbtn" data-tip="Close" onClick=${props.onClose}>${icon("close")}</button>
      </div>
      ${err ? html`<p class="errline">Could not load the activity log: ${err}</p>`
      : rows == null ? html`<div class="empty">Loading…</div>`
      : rows.length === 0 ? html`<div class="empty">No events recorded yet.</div>`
      : html`<div class="tablewrap" style=${{ maxHeight: "50vh", overflowY: "auto" }}><table>
          <thead><tr><th>Time</th><th>Event</th><th>User</th><th>From</th><th>Detail</th></tr></thead>
          <tbody>${rows.map(function (r, i) {
            var l = labels[r.type] || { text: r.type, cls: "pending", ic: "help_outline" };
            return html`<tr key=${i}>
              <td style=${{ whiteSpace: "nowrap" }}>${fmtDate(r.ts)}</td>
              <td><span class="chip ${l.cls}">${icon(l.ic)}${l.text}</span></td>
              <td>${r.user || "—"}</td>
              <td style=${{ whiteSpace: "nowrap" }}>${r.ip || "—"}${r.country ? " (" + r.country + ")" : ""}</td>
              <td class="notes" title=${r.ua ? "UA: " + r.ua : undefined}>${r.detail || "—"}</td>
            </tr>`;
          })}</tbody>
        </table></div>`}
      <p class="hint" style=${{ marginTop: "10px" }}>Events are kept for 60 days. Verified sign-ins are logged with the signed-in identity; failures are self-reported by the browser. The authoritative sign-in record is Entra ID's sign-in log for “eSUB Shared Publishing Admin”.</p>
    <//>`;
  }

  function FailModal(props) {
    var p = props.pending;
    var prompt = claudePrompt(p);
    return html`<${Modal} onClose=${props.onClose}>
      <h2>Publish failed — ${p.slug}</h2>
      <p class="sub">The ${p.kind} for “${p.slug}” did not complete. ${p.error || ""}</p>
      <p class="sub"><${HelpDesk} suffix=" so the pipeline can be investigated." /></p>
      <label>Investigation prompt (paste into Claude or the ticket)</label>
      <div class="copyblock">${prompt}</div>
      <div class="actions">
        <button class="btn btn-quiet" onClick=${function () { props.copy(prompt, "Prompt copied"); }}>${icon("content_copy")} Copy Prompt</button>
        <button class="btn btn-primary" onClick=${props.onClose}>Close</button>
      </div>
    <//>`;
  }

  // Account-disabled gate: shown when /me says disabled. The proxy also
  // hard-blocks every data call server-side, so this screen is honest.
  function DisabledScreen(props) {
    return html`<div class="login-wrap"><div class="card login-card">
      <p class="brand">e<span>SUB</span> Shared</p>
      <p class="tag">Publishing Admin</p>
      <p>Your account has been disabled.</p>
      <p class="hint" style=${{ marginTop: "12px" }}>To restore access, please open an eSUB Help Desk ticket — <${HelpDesk} suffix="." /></p>
      <button class="btn btn-quiet" style=${{ marginTop: "18px" }} onClick=${props.onSignOut}>Sign out</button>
    </div></div>`;
  }

  // ---------- app root ----------
  function App() {
    var s1 = useState("boot"); var phase = s1[0], setPhase = s1[1];
    var s2 = useState(null); var user = s2[0], setUser = s2[1];
    var s3 = useState(null); var store = s3[0], setStore = s3[1];
    var s4 = useState(null); var me = s4[0], setMe = s4[1];

    useEffect(function () {
      (async function () {
        if (window.AdminAuth.isConfigured) {
          var acct = await window.AdminAuth.init();
          reportLoginEvent(acct);
          if (acct) {
            setUser(acct);
            // Proxy mode: the Entra login is the only gate — no GitHub token to collect.
            if (CFG.proxy && CFG.proxy.baseUrl) {
              // Role/profile from the proxy. If the lookup itself fails, fall
              // back to standard (least privilege) rather than blocking entry.
              var profile;
              try { profile = await window.ProxyApi.get("/me"); }
              catch (e) {
                profile = { email: (acct.username || "").toLowerCase(), name: acct.name, firstName: acct.firstName, role: "standard", disabled: false, degraded: true };
              }
              setMe(profile);
              if (profile.disabled) { setPhase("disabled"); return; }
              setStore(window.AdminData.makeStore(acct));
              setPhase("app");
              return;
            }
            // PAT fallback mode has no proxy and therefore no role registry:
            // whoever holds the team token has full control already.
            setMe({ email: (acct.username || "").toLowerCase(), name: acct.name, firstName: acct.firstName, role: "admin", disabled: false, patMode: true });
            var pat = null;
            try { pat = sessionStorage.getItem("shared-admin-pat"); } catch (e) {}
            if (pat) {
              window.GitHubApi.setToken(pat);
              setStore(window.AdminData.makeStore(acct));
              setPhase("app");
            } else setPhase("pat");
            return;
          }
        }
        setPhase("login");
      })();
    }, []);

    function signOut() {
      window.AdminAuth.logout();
    }

    if (phase === "boot") return html`<div class="login-wrap"><div class="empty">Loading…</div></div>`;
    if (phase === "login") return html`<div><${ThemeToggle} floating=${true} /><${LoginScreen} configured=${window.AdminAuth.isConfigured} onLogin=${function () { window.AdminAuth.login(); }} /></div>`;
    if (phase === "disabled") return html`<div><${ThemeToggle} floating=${true} /><${DisabledScreen} onSignOut=${signOut} /></div>`;
    if (phase === "pat") return html`<div><${ThemeToggle} floating=${true} /><${PatGate} user=${user} onBack=${signOut} onReady=${function () { setStore(window.AdminData.makeStore(user)); setPhase("app"); }} /></div>`;
    return html`<${Main} store=${store} user=${user} me=${me} onSignOut=${signOut} />`;
  }

  ReactDOM.createRoot(document.getElementById("root")).render(html`<${App} />`);
})();
