/* Site admin for raman-mittal-site.
   Reads and saves the content files in the GitHub repository through the GitHub API.
   Cloudflare Pages rebuilds the website after every save. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k) || sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v, keep) { try { (keep ? localStorage : sessionStorage).setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) {} }
  };
  var API = (store.get("rm-admin-api") || "https://api.github.com").replace(/\/$/, "");
  var P = { poems: "content/poems.json", books: "content/books.json", articles: "content/articles.json", themes: "content/themes.json", site: "content/site.json" };
  var cfg = null, data = {}, enc = new TextEncoder(), dec = new TextDecoder();
  var sel = { poem: null, book: null, article: null };

  /* ---------- helpers ---------- */
  function slugify(s) {
    return String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function uniqueSlug(base, list) { var s = base || "item", n = 2; while (list.some(function (x) { return x.slug === s; })) s = base + "-" + n++; return s; }
  function today() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toB64(bytes) { var s = "", step = 0x8000; for (var i = 0; i < bytes.length; i += step) s += String.fromCharCode.apply(null, bytes.subarray(i, i + step)); return btoa(s); }
  function fromB64(s) { var b = atob(String(s).replace(/\s/g, "")), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function cleanText(t) { return String(t || "").replace(/\r\n?/g, "\n").split("\n").map(function (l) { return l.replace(/\s+$/, ""); }).join("\n").replace(/^\n+|\n+$/g, "").replace(/\n{3,}/g, "\n\n"); }
  function stanzas(t) { return cleanText(t).split(/\n\s*\n/).filter(Boolean).map(function (s) { return "<p>" + s.split("\n").map(esc).join("<br>") + "</p>"; }).join(""); }
  function list(v) { return String(v || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean); }
  var toastTimer;
  function toast(msg, bad) {
    var t = $("#toast"); t.textContent = msg; t.classList.toggle("bad", !!bad); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, bad ? 9000 : 5000);
  }
  function busy(form, on) { $$("button", form).forEach(function (b) { b.disabled = on; }); form.style.opacity = on ? ".7" : ""; }
  var SAVED = "Saved. The website will show the change in about a minute.";

  /* ---------- GitHub ---------- */
  function gh(method, path, body) {
    return fetch(API + "/repos/" + cfg.repo + "/" + path, {
      method: method, cache: "no-store",
      headers: Object.assign({ Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, body ? { "Content-Type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.text().then(function (txt) {
        var j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
        if (!res.ok) { var err = new Error(explain(res.status, j)); err.status = res.status; throw err; }
        return j;
      });
    }, function () { throw new Error("Could not reach GitHub. Check the internet connection and try again."); });
  }
  function explain(status, j) {
    if (status === 401) return "The access key was not accepted. Sign out and sign in again with a valid key.";
    if (status === 403) return "The access key doesn't have permission for this. It needs Contents: Read and write, and Actions: Read and write for importing.";
    if (status === 404) return "Not found. Check the repository name, the branch and the access key.";
    if (status === 409) return "This was changed somewhere else at the same moment. Please press Save again.";
    if (status === 413 || status === 422) return (j && j.message) || "GitHub didn't accept this file. Very large files may need to be smaller.";
    return "GitHub returned an error (" + status + "). " + ((j && j.message) || "");
  }
  function ref() { return "?ref=" + encodeURIComponent(cfg.branch); }
  function readJSON(path) {
    return gh("GET", "contents/" + path + ref()).then(function (j) {
      var p = j.content ? Promise.resolve(j.content) : gh("GET", "git/blobs/" + j.sha).then(function (b) { return b.content; });
      return p.then(function (c) { data[path] = { sha: j.sha, value: JSON.parse(dec.decode(fromB64(c))) }; return data[path].value; });
    });
  }
  // Apply a change to the latest version of a file, then save it.
  function update(path, mutate, message, tries) {
    tries = tries || 0;
    return readJSON(path).then(function (value) {
      var out = mutate(value) || value;
      var indent = path === P.poems ? 1 : 2;
      return gh("PUT", "contents/" + path, { message: message, branch: cfg.branch, sha: data[path].sha, content: toB64(enc.encode(JSON.stringify(out, null, indent) + "\n")) })
        .then(function (j) { data[path] = { sha: j.content.sha, value: out }; return out; });
    }).catch(function (e) { if (e.status === 409 && tries < 2) return update(path, mutate, message, tries + 1); throw e; });
  }
  function putFile(path, bytes, message) {
    return gh("GET", "contents/" + path + ref()).then(function (j) { return j.sha; }, function (e) { if (e.status === 404) return null; throw e; })
      .then(function (sha) {
        var body = { message: message, branch: cfg.branch, content: toB64(bytes) };
        if (sha) body.sha = sha;
        return gh("PUT", "contents/" + path, body).then(function () { return path; });
      });
  }
  function imageBytes(file, max) {
    return createImageBitmap(file).then(function (bmp) {
      var s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      var c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise(function (r) { c.toBlob(r, "image/jpeg", 0.86); });
    }).then(function (blob) { return blob.arrayBuffer(); }).then(function (b) { return new Uint8Array(b); });
  }
  function showThumb(el, src, label) { el.innerHTML = src ? '<img src="' + esc(src) + '" alt="" onerror="this.replaceWith(document.createTextNode(\'Picture saved. It appears here after the website updates.\'))">' + (label ? "<span>" + esc(label) + "</span>" : "") : '<span>No picture</span>'; }
  var previews = {};
  function siteSrc(p) { return !p ? "" : previews[p] ? previews[p] : /^https?:/.test(p) ? p : "../" + p; }

  /* ---------- sign in ---------- */
  function start() {
    fetch("config.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; }, function () { return {}; }).then(function (c) {
      var saved = null; try { saved = JSON.parse(store.get("rm-admin") || "null"); } catch (e) {}
      if (saved && saved.repo && saved.token) { cfg = saved; return enter(); }
      var f = $("#signinForm");
      if (c.repo) f.repo.value = c.repo;
      if (c.branch) f.branch.value = c.branch;
      $("#signin").hidden = false;
    });
  }
  $("#signinForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target;
    cfg = { repo: f.repo.value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/$/, ""), token: f.token.value.trim(), branch: f.branch.value.trim() || "main" };
    $("#signinErr").textContent = "";
    busy(f, true);
    readJSON(P.site).then(function () {
      store.set("rm-admin", JSON.stringify(cfg), f.remember.checked);
      $("#signin").hidden = true; enter();
    }).catch(function (err) { $("#signinErr").textContent = err.message; }).then(function () { busy(f, false); });
  });
  $("#signOut").addEventListener("click", function () { store.del("rm-admin"); location.reload(); });

  function enter() {
    $("#loading").hidden = false;
    Promise.all([readJSON(P.poems), readJSON(P.books), readJSON(P.articles), readJSON(P.themes), readJSON(P.site)]).then(function () {
      $("#loading").hidden = true; $("#work").hidden = false; $("#signOut").hidden = false;
      renderPoems(); renderBooks(); renderArticles(); fillProfile(); counts();
    }).catch(function (err) {
      $("#loading").hidden = true; store.del("rm-admin"); $("#signin").hidden = false; $("#signinErr").textContent = err.message;
    });
  }
  function counts() {
    $("#nPoems").textContent = data[P.poems].value.length;
    $("#nBooks").textContent = data[P.books].value.length;
    $("#nArticles").textContent = data[P.articles].value.length;
  }

  /* ---------- tabs ---------- */
  $$(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      $$(".tabs button").forEach(function (x) { x.setAttribute("aria-selected", String(x === b)); });
      $$(".pane").forEach(function (p) { p.hidden = p.getAttribute("data-pane") !== b.getAttribute("data-tab"); });
    });
  });

  /* ---------- poems ---------- */
  var poemForm = $("#poemForm");
  function themes() { return data[P.themes].value; }
  function themeName(k) { var t = themes().find(function (x) { return x.key === k; }); return t ? t.name : k; }
  function renderPoems() {
    var q = $("#poemQ").value.trim().toLowerCase(), th = $("#poemTheme").value;
    var tsel = $("#poemTheme"), keep = tsel.value;
    tsel.innerHTML = '<option value="">All themes</option>' + themes().map(function (t) { return '<option value="' + esc(t.key) + '">' + esc(t.name) + "</option>"; }).join("");
    tsel.value = keep;
    var items = data[P.poems].value.filter(function (p) { return (!th || p.theme === th) && (!q || p.title.toLowerCase().indexOf(q) > -1); });
    $("#poemList").innerHTML = items.map(function (p) {
      return '<li><button type="button" data-slug="' + esc(p.slug) + '"' + (sel.poem === p.slug ? ' aria-current="true"' : "") + '><span class="t">' + esc(p.title) + '</span><span class="s">' + esc(themeName(p.theme)) + (p.text ? "" : " · <b>no text yet</b>") + "</span></button></li>";
    }).join("") || '<li style="padding:12px;color:var(--ink-soft)">No poems match.</li>';
    var f = poemForm.theme; var v = f.value;
    f.innerHTML = themes().map(function (t) { return '<option value="' + esc(t.key) + '">' + esc(t.name) + "</option>"; }).join("") + '<option value="__new">+ A new theme…</option>';
    if (v) f.value = v;
  }
  $("#poemQ").addEventListener("input", renderPoems);
  $("#poemTheme").addEventListener("change", renderPoems);
  $("#poemList").addEventListener("click", function (e) { var b = e.target.closest("button[data-slug]"); if (b) openPoem(b.getAttribute("data-slug")); });
  $("#newPoem").addEventListener("click", function () { openPoem(null); });
  poemForm.theme.addEventListener("change", function () { $(".newtheme", poemForm).hidden = poemForm.theme.value !== "__new"; });
  poemForm.text.addEventListener("input", function () { $("#poemPreview").innerHTML = stanzas(poemForm.text.value); });
  poemForm.image.addEventListener("change", function () { var f = poemForm.image.files[0]; if (f) showThumb($("#poemThumb"), URL.createObjectURL(f), "New picture"); });

  function openPoem(slug) {
    var p = slug ? data[P.poems].value.find(function (x) { return x.slug === slug; }) : null;
    sel.poem = slug; renderPoems();
    poemForm.reset(); poemForm.hidden = false; $("#poemHint").hidden = true;
    $(".newtheme", poemForm).hidden = true;
    $("#poemFormTitle").textContent = p ? "Edit poem" : "New poem";
    poemForm.title.value = p ? p.title : "";
    poemForm.theme.value = p ? p.theme : (themes()[0] || {}).key || "__new";
    if (poemForm.theme.value === "__new") $(".newtheme", poemForm).hidden = false;
    poemForm.added.value = p ? (p.added || "") : today();
    poemForm.inBook.checked = p ? /rhythm of law/i.test(p.book || "") : false;
    poemForm.text.value = p ? (p.text || "") : "";
    poemForm.note.value = p ? (p.note || "") : "";
    $("#poemPreview").innerHTML = stanzas(poemForm.text.value);
    showThumb($("#poemThumb"), p && p.image ? siteSrc(p.image) : "", p && p.image ? "Current picture" : "");
    $("#poemDelete").hidden = !p;
    var view = $("#poemView"); view.hidden = !p; if (p) view.href = "../poetry/" + p.theme + "/" + p.slug + "/";
    poemForm.title.focus();
    if (window.innerWidth < 900) poemForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $("#poemFile").addEventListener("change", function (e) {
    var file = e.target.files[0]; if (!file) return;
    var done = function (t) { poemForm.text.value = cleanText(t); poemForm.text.dispatchEvent(new Event("input")); toast("Text loaded from " + file.name + ". Check it, then press Save."); e.target.value = ""; };
    if (/\.docx$/i.test(file.name)) {
      loadMammoth().then(function () { return file.arrayBuffer(); }).then(function (buf) { return window.mammoth.extractRawText({ arrayBuffer: buf }); })
        .then(function (r) { done(r.value.replace(/\n{4,}/g, "\u0000").replace(/\n\n/g, "\n").replace(/\u0000/g, "\n\n")); })
        .catch(function () { toast("That Word file couldn't be read. Try copying the text and pasting it instead.", true); });
    } else file.text().then(done);
  });
  var mammothP;
  function loadMammoth() {
    return mammothP = mammothP || new Promise(function (ok, no) {
      var s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js"; s.onload = ok; s.onerror = no; document.head.appendChild(s);
    });
  }

  poemForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = poemForm, title = f.title.value.trim(), text = cleanText(f.text.value);
    if (!title) return toast("Please give the poem a title.", true);
    var themeKey = f.theme.value, newName = f.newTheme.value.trim(), slug = sel.poem;
    var isNew = !slug;
    busy(f, true);
    var chain = Promise.resolve();
    if (themeKey === "__new") {
      if (!newName) { busy(f, false); return toast("Please type the name of the new theme.", true); }
      themeKey = slugify(newName);
      chain = chain.then(function () {
        return update(P.themes, function (list) { if (!list.some(function (t) { return t.key === themeKey; })) list.push({ key: themeKey, name: newName }); return list; }, "Add theme: " + newName);
      });
    }
    if (isNew) slug = uniqueSlug(slugify(title), data[P.poems].value);
    var file = f.image.files[0], imagePath = null;
    if (file) chain = chain.then(function () { return imageBytes(file, 1600); }).then(function (b) { return putFile("assets/uploads/poem-" + slug + "-" + Date.now() + ".jpg", b, "Picture for poem: " + title); }).then(function (p) { imagePath = p; previews[p] = URL.createObjectURL(file); });
    chain.then(function () {
      return update(P.poems, function (list) {
        var p = list.find(function (x) { return x.slug === slug; });
        if (!p) { p = { slug: uniqueSlug(slug, list) }; slug = p.slug; list.push(p); }
        p.title = title; p.theme = themeKey; p.text = text;
        p.added = f.added.value || p.added || (isNew ? today() : "");
        p.book = f.inBook.checked ? "The Rhythm of Law" : "";
        p.note = f.note.value.trim();
        if (imagePath) p.image = imagePath;
        Object.keys(p).forEach(function (k) { if (p[k] === "" || p[k] == null) delete p[k]; });
        p.title = title; p.slug = slug;
        return list;
      }, (isNew ? "Add poem: " : "Update poem: ") + title);
    }).then(function () {
      sel.poem = slug; renderPoems(); counts(); openPoem(slug); toast(SAVED);
    }).catch(function (err) { toast(err.message, true); }).then(function () { busy(f, false); });
  });
  $("#poemDelete").addEventListener("click", function () {
    var p = data[P.poems].value.find(function (x) { return x.slug === sel.poem; }); if (!p) return;
    if (!confirm("Delete “" + p.title + "”? Its page will be removed from the website.")) return;
    busy(poemForm, true);
    update(P.poems, function (list) { return list.filter(function (x) { return x.slug !== p.slug; }); }, "Delete poem: " + p.title)
      .then(function () { sel.poem = null; poemForm.hidden = true; $("#poemHint").hidden = false; renderPoems(); counts(); toast("Deleted. The website will update in about a minute."); })
      .catch(function (err) { toast(err.message, true); }).then(function () { busy(poemForm, false); });
  });

  /* ---------- books ---------- */
  var bookForm = $("#bookForm");
  function link(b, label) { var l = (b.links || []).find(function (x) { return x[0] === label; }); return l ? l[1] : ""; }
  function renderBooks() {
    $("#bookList").innerHTML = data[P.books].value.map(function (b) {
      return '<li><button type="button" data-slug="' + esc(b.slug) + '"' + (sel.book === b.slug ? ' aria-current="true"' : "") + ">" +
        (b.cover ? '<img src="' + esc(siteSrc(b.cover)) + '" alt="">' : '<span class="ph"></span>') +
        '<span><span class="t">' + esc(b.title) + '</span><span class="s">' + esc(b.year) + (b.cover ? "" : " · <b>no cover</b>") + "</span></span></button></li>";
    }).join("");
  }
  $("#bookList").addEventListener("click", function (e) { var b = e.target.closest("button[data-slug]"); if (b) openBook(b.getAttribute("data-slug")); });
  $("#newBook").addEventListener("click", function () { openBook(null); });
  bookForm.coverFile.addEventListener("change", function () { var f = bookForm.coverFile.files[0]; if (f) showThumb($("#bookThumb"), URL.createObjectURL(f), "New cover"); });
  function openBook(slug) {
    var b = slug ? data[P.books].value.find(function (x) { return x.slug === slug; }) : null;
    sel.book = slug; renderBooks();
    bookForm.reset(); bookForm.hidden = false; $("#bookHint").hidden = true;
    $("#bookFormTitle").textContent = b ? "Edit book" : "New book";
    bookForm.title.value = b ? b.title : ""; bookForm.credit.value = b ? (b.credit || "") : "By Raman Mittal";
    bookForm.year.value = b ? b.year : new Date().getFullYear(); bookForm.publisher.value = b ? (b.publisher || "") : "";
    bookForm.isbn.value = b ? (b.isbn || "") : "";
    bookForm.amazon.value = b ? link(b, "Buy on Amazon") : ""; bookForm.google.value = b ? link(b, "Google Books") : "";
    showThumb($("#bookThumb"), b && b.cover ? siteSrc(b.cover) : "", b && b.cover ? "Current cover" : "");
    $("#bookDelete").hidden = !b; $("#bookUp").hidden = !b; $("#bookDown").hidden = !b;
    bookForm.title.focus();
  }
  function people(credit) {
    var m = String(credit || "").match(/^\s*(edited|ed\.)\s+by\s+(.+)$/i), a = String(credit || "").match(/^\s*by\s+(.+)$/i);
    var names = function (s) { return s.split(/,|\band\b|&/).map(function (x) { return x.trim(); }).filter(Boolean); };
    return m ? { editors: names(m[2]) } : a ? { authors: names(a[1]) } : {};
  }
  bookForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = bookForm, title = f.title.value.trim(); if (!title) return;
    var slug = sel.book || uniqueSlug(slugify(title), data[P.books].value), isNew = !sel.book, file = f.coverFile.files[0], coverPath = null;
    busy(f, true);
    var chain = Promise.resolve();
    if (file) chain = chain.then(function () { return imageBytes(file, 900); }).then(function (b) { return putFile("assets/img/books/" + slug + ".jpg", b, "Cover for book: " + title); }).then(function (p) { coverPath = p; previews[p] = URL.createObjectURL(file); });
    chain.then(function () {
      return update(P.books, function (list) {
        var b = list.find(function (x) { return x.slug === slug; });
        if (!b) { b = { slug: slug }; list.unshift(b); }
        b.title = title; b.credit = f.credit.value.trim(); b.year = Number(f.year.value) || b.year;
        b.publisher = f.publisher.value.trim(); b.isbn = f.isbn.value.trim();
        var pp = people(b.credit); delete b.authors; delete b.editors; Object.assign(b, pp);
        var other = (b.links || []).filter(function (l) { return l[0] !== "Buy on Amazon" && l[0] !== "Google Books"; });
        b.links = [].concat(f.amazon.value.trim() ? [["Buy on Amazon", f.amazon.value.trim()]] : [], f.google.value.trim() ? [["Google Books", f.google.value.trim()]] : [], other);
        if (coverPath) b.cover = coverPath;
        return list;
      }, (isNew ? "Add book: " : "Update book: ") + title);
    }).then(function () { sel.book = slug; renderBooks(); counts(); openBook(slug); toast(SAVED); })
      .catch(function (err) { toast(err.message, true); }).then(function () { busy(f, false); });
  });
  function moveBook(d) {
    var slug = sel.book; busy(bookForm, true);
    update(P.books, function (list) {
      var i = list.findIndex(function (x) { return x.slug === slug; }), j = i + d;
      if (i < 0 || j < 0 || j >= list.length) return list;
      var t = list[i]; list[i] = list[j]; list[j] = t; return list;
    }, "Reorder books").then(function () { renderBooks(); toast(SAVED); }).catch(function (err) { toast(err.message, true); }).then(function () { busy(bookForm, false); });
  }
  $("#bookUp").addEventListener("click", function () { moveBook(-1); });
  $("#bookDown").addEventListener("click", function () { moveBook(1); });
  $("#bookDelete").addEventListener("click", function () {
    var b = data[P.books].value.find(function (x) { return x.slug === sel.book; }); if (!b) return;
    if (b.slug === "the-rhythm-of-law" && !confirm("The Rhythm of Law has its own page on the website. Delete it anyway?")) return;
    if (!confirm("Delete the book “" + b.title + "”?")) return;
    update(P.books, function (list) { return list.filter(function (x) { return x.slug !== b.slug; }); }, "Delete book: " + b.title)
      .then(function () { sel.book = null; bookForm.hidden = true; $("#bookHint").hidden = false; renderBooks(); counts(); toast("Deleted."); })
      .catch(function (err) { toast(err.message, true); });
  });

  /* ---------- articles ---------- */
  var artForm = $("#articleForm");
  function renderArticles() {
    $("#articleList").innerHTML = data[P.articles].value.map(function (a) {
      return '<li><button type="button" data-slug="' + esc(a.slug) + '"' + (sel.article === a.slug ? ' aria-current="true"' : "") + '><span class="t">' + esc(a.title) + '</span><span class="s">' + esc(a.journal) + ", " + esc(a.year) + "</span></button></li>";
    }).join("");
  }
  $("#articleList").addEventListener("click", function (e) { var b = e.target.closest("button[data-slug]"); if (b) openArticle(b.getAttribute("data-slug")); });
  $("#newArticle").addEventListener("click", function () { openArticle(null); });
  function openArticle(slug) {
    var a = slug ? data[P.articles].value.find(function (x) { return x.slug === slug; }) : null;
    sel.article = slug; renderArticles();
    artForm.reset(); artForm.hidden = false; $("#articleHint").hidden = true;
    $("#articleFormTitle").textContent = a ? "Edit article" : "New article";
    var v = function (k, d) { return a && a[k] != null ? a[k] : (d || ""); };
    artForm.title.value = v("title"); artForm.authors.value = a ? (a.authors || []).join(", ") : "Raman Mittal";
    artForm.journal.value = v("journal"); artForm.volume.value = v("volume"); artForm.issue.value = v("issue"); artForm.pages.value = v("pages");
    artForm.year.value = v("year", new Date().getFullYear()); artForm.dateLabel.value = v("dateLabel"); artForm.doi.value = v("doi");
    artForm.page.value = v("page"); artForm.pdf.value = v("pdf"); artForm.keywords.value = a ? (a.keywords || []).join(", ") : "";
    artForm.abstract.value = v("abstract"); artForm.summary.value = v("summary"); artForm.citation.value = v("citation");
    $("#articleDelete").hidden = !a;
    var view = $("#articleView"); view.hidden = !a; if (a) view.href = "../research/articles/" + a.slug + "/";
    artForm.title.focus();
  }
  $("#makeCite").addEventListener("click", function () {
    var f = artForm, au = list(f.authors.value).join(" and ");
    f.citation.value = au + ", “" + f.title.value.trim() + "”, " + (f.volume.value ? f.volume.value + (f.issue.value ? "(" + f.issue.value + ")" : "") + " " : "") +
      f.journal.value.trim() + (f.pages.value ? " " + f.pages.value : "") + " (" + f.year.value + ")" + (f.doi.value ? ", https://doi.org/" + f.doi.value.trim() : "");
  });
  artForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = artForm, title = f.title.value.trim(); if (!title) return;
    var slug = sel.article || uniqueSlug(slugify(title).slice(0, 70).replace(/-+$/, ""), data[P.articles].value), isNew = !sel.article, file = f.pdfFile.files[0], pdfPath = null;
    if (file && file.size > 25 * 1024 * 1024) return toast("That PDF is larger than 25 MB. Please use a link to the journal's PDF instead.", true);
    busy(f, true);
    var chain = Promise.resolve();
    if (file) chain = file.arrayBuffer().then(function (b) { return putFile("assets/files/" + slug + ".pdf", new Uint8Array(b), "PDF for article: " + title); }).then(function (p) { pdfPath = p; });
    chain.then(function () {
      return update(P.articles, function (arr) {
        var a = arr.find(function (x) { return x.slug === slug; });
        if (!a) { a = { slug: slug }; arr.unshift(a); }
        a.title = title; a.authors = list(f.authors.value); a.journal = f.journal.value.trim();
        a.volume = f.volume.value.trim(); a.issue = f.issue.value.trim(); a.pages = f.pages.value.trim();
        a.year = Number(f.year.value) || a.year; a.datePublished = a.datePublished && String(a.datePublished).indexOf(String(a.year)) === 0 ? a.datePublished : String(a.year);
        a.dateLabel = f.dateLabel.value.trim() || String(a.year); a.doi = f.doi.value.trim(); a.page = f.page.value.trim();
        a.pdf = pdfPath || f.pdf.value.trim(); a.keywords = list(f.keywords.value);
        a.abstract = f.abstract.value.trim(); a.summary = f.summary.value.trim(); a.citation = f.citation.value.trim();
        arr.sort(function (x, y) { return (Number(y.year) || 0) - (Number(x.year) || 0); });
        return arr;
      }, (isNew ? "Add article: " : "Update article: ") + title);
    }).then(function () { sel.article = slug; renderArticles(); counts(); openArticle(slug); toast(SAVED); })
      .catch(function (err) { toast(err.message, true); }).then(function () { busy(f, false); });
  });
  $("#articleDelete").addEventListener("click", function () {
    var a = data[P.articles].value.find(function (x) { return x.slug === sel.article; }); if (!a) return;
    if (!confirm("Delete the article “" + a.title + "”?")) return;
    update(P.articles, function (arr) { return arr.filter(function (x) { return x.slug !== a.slug; }); }, "Delete article: " + a.title)
      .then(function () { sel.article = null; artForm.hidden = true; $("#articleHint").hidden = false; renderArticles(); counts(); toast("Deleted."); })
      .catch(function (err) { toast(err.message, true); });
  });

  /* ---------- profile ---------- */
  var prof = $("#profileForm");
  var plain = function (h) { var d = document.createElement("div"); d.innerHTML = h; return d.textContent; };
  function fillProfile() {
    var s = data[P.site].value;
    prof.role.value = s.role || ""; prof.affiliation.value = s.affiliation || ""; prof.tagline.value = s.tagline || "";
    prof.bio.value = (s.bio || []).map(plain).join("\n\n"); prof.interests.value = (s.interests || []).join(", ");
    prof.visits.value = (s.visits || []).join("\n"); prof.emails.value = (s.emails || []).join(", "); prof.linkedin.value = s.linkedin || "";
    showThumb($("#photoThumb"), siteSrc(s.photo), "Current photo");
  }
  prof.photo.addEventListener("change", function () { var f = prof.photo.files[0]; if (f) showThumb($("#photoThumb"), URL.createObjectURL(f), "New photo"); });
  prof.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = prof, file = f.photo.files[0], photoPath = null; busy(f, true);
    var chain = Promise.resolve();
    if (file) chain = imageBytes(file, 1400).then(function (b) { return putFile("assets/uploads/photo-" + Date.now() + ".jpg", b, "New cover photo"); }).then(function (p) { photoPath = p; previews[p] = URL.createObjectURL(file); });
    chain.then(function () {
      return update(P.site, function (s) {
        s.role = f.role.value.trim(); s.affiliation = f.affiliation.value.trim(); s.tagline = f.tagline.value.trim();
        var paras = f.bio.value.split(/\n\s*\n/).map(function (x) { return x.trim(); }).filter(Boolean);
        s.bio = paras.map(function (p, i) { return s.bio && s.bio[i] && plain(s.bio[i]) === p ? s.bio[i] : esc(p); });
        s.interests = list(f.interests.value); s.visits = f.visits.value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
        s.emails = list(f.emails.value); s.linkedin = f.linkedin.value.trim();
        if (photoPath) { s.photo = photoPath; s.cutout = ""; }
        return s;
      }, "Update profile");
    }).then(function () { fillProfile(); toast(SAVED); }).catch(function (err) { toast(err.message, true); }).then(function () { busy(f, false); });
  });

  /* ---------- import ---------- */
  $$("[data-run]").forEach(function (b) {
    b.addEventListener("click", function () {
      var what = b.getAttribute("data-run"), st = $("#runStatus");
      b.disabled = true; st.textContent = "Starting…";
      var started = Date.now();
      gh("POST", "actions/workflows/import.yml/dispatches", { ref: cfg.branch, inputs: { what: what } }).then(function () {
        st.textContent = "Running. This usually takes one to three minutes…";
        var poll = function () {
          gh("GET", "actions/workflows/import.yml/runs?per_page=1&event=workflow_dispatch").then(function (r) {
            var run = r && r.workflow_runs && r.workflow_runs[0];
            if (!run || Date.parse(run.created_at) < started - 60000 || run.status !== "completed") {
              if (Date.now() - started > 10 * 60000) { st.innerHTML = 'Still running. <a href="https://github.com/' + esc(cfg.repo) + '/actions" target="_blank" rel="noopener">See progress on GitHub</a>.'; b.disabled = false; return; }
              return setTimeout(poll, 6000);
            }
            b.disabled = false;
            if (run.conclusion === "success") {
              st.innerHTML = "Finished. The website is updating now and will be ready in about a minute. " + '<a href="' + esc(run.html_url) + '" target="_blank" rel="noopener">Details</a>';
              Promise.all([readJSON(P.poems), readJSON(P.books)]).then(function () { renderPoems(); renderBooks(); counts(); });
            } else st.innerHTML = 'The import stopped with a problem. <a href="' + esc(run.html_url) + '" target="_blank" rel="noopener">Open the details</a>.';
          }).catch(function (err) { st.textContent = err.message; b.disabled = false; });
        };
        setTimeout(poll, 8000);
      }).catch(function (err) { st.textContent = err.message; b.disabled = false; });
    });
  });

  window.addEventListener("beforeunload", function (e) {
    if ($$("form.editor:not([hidden]) button[disabled]").length) { e.preventDefault(); e.returnValue = ""; }
  });
  start();
})();
