/* Raman Mittal — small enhancements. Every page works without this file. */
(function () {
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* Light / dark mode */
  var root = document.documentElement, modeBtn = $("#modeBtn");
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : { matches: false };
  var saved = store.get("rm-theme");
  if (saved === "dark" || saved === "light") root.setAttribute("data-theme", saved);
  function effective() { return root.getAttribute("data-theme") || (mq.matches ? "dark" : "light"); }
  function paint() { if (modeBtn) modeBtn.textContent = effective() === "dark" ? "Light" : "Dark"; modeBtn.setAttribute("aria-label", effective() === "dark" ? "Switch to light mode" : "Switch to dark mode"); }
  if (modeBtn) {
    modeBtn.hidden = false; paint();
    modeBtn.addEventListener("click", function () {
      var t = effective() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", t); store.set("rm-theme", t); paint();
    });
    if (mq.addEventListener) mq.addEventListener("change", paint);
  }

  /* Mobile menu: close after choosing a link, or with Escape */
  var menu = $(".menu");
  if (menu) {
    $$("a", menu).forEach(function (a) { a.addEventListener("click", function () { menu.removeAttribute("open"); }); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && menu.open) { menu.removeAttribute("open"); $("summary", menu).focus(); } });
    menu.addEventListener("toggle", function () { document.body.style.overflow = menu.open ? "hidden" : ""; });
  }

  /* Home: law and justice pairs */
  var pairBox = $("[data-pairs]");
  if (pairBox) {
    var pairs = JSON.parse(pairBox.getAttribute("data-pairs"));
    var link = $("#pairLink"), L = $("#pairL"), R = $("#pairR"), i = 0, paused = false;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var set = function (n, animate) {
      var go = function () {
        var p = pairs[n]; L.textContent = p.l; R.textContent = p.r; link.href = p.href;
        link.setAttribute("aria-label", "Read the poem " + p.title); link.classList.remove("fade");
      };
      if (animate && !reduce) { link.classList.add("fade"); setTimeout(go, 350); } else go();
    };
    var next = function () { i = (i + 1) % pairs.length; set(i, true); };
    pairBox.addEventListener("mouseenter", function () { paused = true; });
    pairBox.addEventListener("mouseleave", function () { paused = false; });
    pairBox.addEventListener("focusin", function () { paused = true; });
    pairBox.addEventListener("focusout", function () { paused = false; });
    if (!reduce) setInterval(function () { if (!paused && !document.hidden) next(); }, 3800);
    var nb = $("#pairNext"); if (nb) { nb.hidden = false; nb.addEventListener("click", next); }
  }

  /* Random poem buttons */
  $$("[data-random]").forEach(function (b) {
    b.hidden = false;
    b.addEventListener("click", function () {
      var list = JSON.parse(b.getAttribute("data-random"));
      location.href = list[Math.floor(Math.random() * list.length)];
    });
  });

  /* Poetry index search */
  var q = $("#q");
  if (q) {
    $(".search").hidden = false;
    var empty = $("#emptyMsg");
    var run = function () {
      var v = q.value.trim().toLowerCase(), any = false;
      $$(".chapter").forEach(function (ch) {
        var shown = 0;
        $$("li[data-title]", ch).forEach(function (li) {
          var hit = !v || li.getAttribute("data-title").indexOf(v) > -1;
          li.hidden = !hit; if (hit) shown++;
        });
        ch.hidden = shown === 0; if (shown) any = true;
      });
      if (empty) { empty.hidden = any; $("#emptyQ").textContent = q.value.trim(); }
    };
    q.addEventListener("input", run);
    var clear = $("#clearQ");
    if (clear) clear.addEventListener("click", function () { q.value = ""; run(); q.focus(); });
  }

  /* Reader: text size */
  var poem = $(".poem");
  if (poem) {
    var scale = parseFloat(store.get("rm-scale")) || 1;
    var apply = function () { poem.style.setProperty("--scale", scale); };
    apply();
    var sz = $(".rbar .sz"); if (sz) sz.hidden = false;
    $$("[data-size]").forEach(function (b) {
      b.addEventListener("click", function () {
        scale = Math.round(Math.min(1.6, Math.max(0.85, scale + parseFloat(b.getAttribute("data-size")) * 0.1)) * 100) / 100;
        apply(); store.set("rm-scale", scale);
      });
    });
  }

  /* Share and copy */
  var share = $(".share");
  if (share) {
    var canon = $('link[rel="canonical"]');
    var url = canon ? canon.href : location.href.split("#")[0];
    var text = share.getAttribute("data-text") || document.title;
    var eu = encodeURIComponent(url), et = encodeURIComponent(text);
    var targets = {
      whatsapp: "https://wa.me/?text=" + encodeURIComponent(text + " " + url),
      facebook: "https://www.facebook.com/sharer/sharer.php?u=" + eu,
      x: "https://twitter.com/intent/tweet?text=" + et + "&url=" + eu,
      linkedin: "https://www.linkedin.com/sharing/share-offsite/?url=" + eu,
      telegram: "https://t.me/share/url?url=" + eu + "&text=" + et,
      email: "mailto:?subject=" + et + "&body=" + encodeURIComponent(text + "\n\n" + url)
    };
    $$("[data-share]", share).forEach(function (a) { a.href = targets[a.getAttribute("data-share")]; });
    share.hidden = false;
    var nat = $(".native", share);
    if (nat && navigator.share) {
      nat.hidden = false;
      nat.addEventListener("click", function () { navigator.share({ title: text, text: text, url: url }).catch(function () {}); });
    }
  }
  function copy(v, msg, statusEl) {
    var done = function (ok) { if (statusEl) statusEl.textContent = ok ? msg : "Couldn't copy. Select the text and copy it yourself."; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(v).then(function () { done(true); }, function () { done(fallback(v)); });
    } else done(fallback(v));
  }
  function fallback(v) {
    var t = document.createElement("textarea"); t.value = v; t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select(); var ok = false; try { ok = document.execCommand("copy"); } catch (e) {} t.remove(); return ok;
  }
  $$("[data-copy]").forEach(function (b) {
    b.hidden = false;
    b.addEventListener("click", function () {
      var v = b.getAttribute("data-copy") === "url" ? (($('link[rel="canonical"]') || {}).href || location.href.split("#")[0]) : b.getAttribute("data-copy");
      copy(v, b.getAttribute("data-msg") || "Copied.", document.getElementById(b.getAttribute("data-status")));
    });
  });
})();
