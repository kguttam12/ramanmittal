#!/usr/bin/env node
/*
  Builds the static site into ./dist from ./content and ./assets.
  No dependencies: run with  node scripts/build.mjs
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { medallion } from "./ornament.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist");
const CONTENT = path.join(ROOT, "content");
const readJSON = f => JSON.parse(fs.readFileSync(path.join(CONTENT, f), "utf8"));

const site = readJSON("site.json");
const themeCfg = readJSON("themes.json");
const books = readJSON("books.json");
const articles = readJSON("articles.json");
const SITE_URL = (process.env.SITE_URL || site.url || "").replace(/\/+$/, "");
const TODAY = new Date().toISOString().slice(0, 10);
const NEW_DAYS = 60;
const warnings = [];

/* ---------- helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slugify = s => String(s).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const titleCase = s => String(s).replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const roman = n => { const m = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]; let r = ""; for (const [v, s] of m) while (n >= v) { r += s; n -= v; } return r; };
const exists = p => fs.existsSync(path.join(ROOT, p));
const abs = p => SITE_URL ? SITE_URL + "/" + p.replace(/^\/+/, "") : "";
const fmtDate = d => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

function dedent(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const ind = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^[ \t]*/)[0].length));
  return lines.map(l => (isFinite(ind) ? l.slice(ind) : l).replace(/\s+$/, "")).join("\n").replace(/\n{3,}/g, "\n\n");
}
function parseMd(src) {
  src = src.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const m = src.match(/^---\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*)$/);
  const meta = {};
  let body = src;
  if (m) {
    body = m[2];
    for (const line of m[1].split("\n")) {
      const k = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (!k) continue;
      let v = k[2].trim();
      if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
      meta[k[1]] = v;
    }
  }
  return { meta, body: dedent(body) };
}
const stanzas = text => text.split(/\n\s*\n/).map(s => `<p>${s.split("\n").map(esc).join("<br>\n")}</p>`).join("\n");
const firstLine = text => { const l = (text.split("\n").find(x => x.trim()) || "").trim(); return l.length > 90 ? l.slice(0, 87).replace(/\s+\S*$/, "") + "…" : l; };

/* ---------- themes & poems ---------- */
const themes = themeCfg.map((t, i) => ({ ...t, idx: i }));
const themeBy = Object.fromEntries(themes.map(t => [t.key, t]));
function themeFor(raw, nameHint) {
  if (!raw) raw = "more-poems";
  const k = slugify(raw);
  if (themeBy[k]) return themeBy[k];
  const byName = themes.find(t => slugify(t.name) === k || (t.short && slugify(t.short) === k));
  if (byName) return byName;
  const t = { key: k, name: nameHint || titleCase(raw), idx: themes.length };
  themes.push(t); themeBy[k] = t;
  warnings.push(`New theme created: "${t.name}" (${k}). Add it to content/themes.json to set its name and position.`);
  return t;
}

const POEMS_FILE = path.join(CONTENT, "poems.json");
const poemDir = CONTENT;
const seen = new Set();
const poems = JSON.parse(fs.readFileSync(POEMS_FILE, "utf8")).filter(p => p && p.title).map((m, i) => {
  let slug = slugify(m.slug || m.title) || "poem-" + (i + 1);
  while (seen.has(slug)) slug += "-2";
  seen.add(slug);
  const theme = themeFor(m.theme, m.themeName);
  const added = /^\d{4}-\d{2}-\d{2}$/.test(m.added || "") ? m.added : "";
  const age = added ? (Date.now() - Date.parse(added)) / 864e5 : Infinity;
  return {
    slug, file: "poems.json", title: String(m.title).trim(), theme, text: dedent(m.text || ""),
    order: Number(m.order) || Infinity, added, isNew: age >= 0 && age < NEW_DAYS,
    book: m.book || "", source: m.source || "", image: m.image || "", note: m.note || "",
    path: `poetry/${theme.key}/${slug}/`
  };
});
themes.sort((a, b) => a.idx - b.idx);
const usedThemes = themes.filter(t => poems.some(p => p.theme === t));
for (const t of usedThemes) {
  t.poems = poems.filter(p => p.theme === t).sort((a, b) =>
    (a.order - b.order) || (a.added || "9999").localeCompare(b.added || "9999") || a.title.localeCompare(b.title));
  t.path = `poetry/${t.key}/`;
}
const ordered = usedThemes.flatMap(t => t.poems);
const withText = ordered.filter(p => p.text);
const missingText = ordered.filter(p => !p.text);
if (missingText.length) warnings.push(`${missingText.length} poem(s) have no text yet. Use "Import poems from the old site" on the admin page, or paste the text in the admin.`);


/* ---------- page shell ---------- */
const NAV = [["poetry/", "Poetry"], ["research/books/the-rhythm-of-law/", "The Rhythm of Law"], ["research/books/", "Books"], ["research/articles/", "Articles"], ["#about", "About"], ["#contact", "Contact"]];
const photo = site.photo && exists(site.photo) ? site.photo : "";
const photoWebp = photo && exists(photo.replace(/\.\w+$/, ".webp")) ? photo.replace(/\.\w+$/, ".webp") : "";
const cutout = site.cutout && exists(site.cutout) ? site.cutout : "";
const cutoutPng = cutout && exists(cutout.replace(/\.\w+$/, ".png")) ? cutout.replace(/\.\w+$/, ".png") : "";
const lecture = site.lecturePhoto && exists(site.lecturePhoto) ? site.lecturePhoto : "";
const lectureWebp = lecture && exists(lecture.replace(/\.\w+$/, ".webp")) ? lecture.replace(/\.\w+$/, ".webp") : "";
const shareImg = site.shareImage && exists(site.shareImage) ? site.shareImage : photo;
if (!photo) warnings.push(`No photo found at ${site.photo}. The cover page shows a monogram until you add it.`);
if (!SITE_URL) warnings.push(`content/site.json "url" is empty: canonical links, sitemap and share previews need the real address (e.g. https://www.ramanmittal.in).`);

const ROSETTE = `<img class="rosette" src="{{pre}}assets/img/guilloche.svg" alt="" aria-hidden="true" width="1040" height="1040" decoding="async">`;
const picture = (src, webp, alt, attrs = "") => webp
  ? `<picture><source srcset="{{pre}}${esc(webp)}" type="image/webp"><img src="{{pre}}${esc(src)}" alt="${esc(alt)}" ${attrs}></picture>`
  : `<img src="{{pre}}${esc(src)}" alt="${esc(alt)}" ${attrs}>`;

function shell({ p, title, description, body, ld = [], navKey, type = "website", image, fixedRoot = false, noindex = false }) {
  const depth = p.split("/").filter(Boolean).length;
  const pre = fixedRoot ? (SITE_URL ? SITE_URL + "/" : "/") : "../".repeat(depth);
  const href = t => t === "#contact" ? t : t.startsWith("#") ? (p === "" ? t : pre + t) : (pre + t) || "./";
  const canonical = abs(p);
  const img = image || shareImg;
  const navLinks = NAV.map(([t, label]) => `<a href="${href(t)}"${navKey === t ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  const graph = ld.length ? `<script type="application/ld+json">${JSON.stringify(ld.length === 1 ? { "@context": "https://schema.org", ...ld[0] } : { "@context": "https://schema.org", "@graph": ld }).replace(/</g, "\\u003c")}</script>\n` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="author" content="${esc(site.name)}">
<meta name="theme-color" content="#0F2A24">
${noindex ? '<meta name="robots" content="noindex">\n' : ""}${canonical ? `<link rel="canonical" href="${esc(canonical)}">\n` : ""}<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="${type}">
<meta property="og:locale" content="en_IN">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">\n` : ""}${img && SITE_URL ? `<meta property="og:image" content="${esc(abs(img))}">\n` : ""}<meta name="twitter:card" content="${img ? "summary_large_image" : "summary"}">
<link rel="icon" href="${pre}assets/img/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="New poems by ${esc(site.name)}" href="${pre}poetry/feed.xml">
<link rel="preload" href="${pre}assets/fonts/cormorant-garamond-latin-500-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${pre}assets/fonts/newsreader-latin-opsz-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${pre}assets/css/site.css">
<script>try{var t=localStorage.getItem("rm-theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
${graph}</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head">
  <div class="wrap">
    <a class="mark" href="${href("")}"><img src="${pre}assets/img/favicon.svg" alt="" width="34" height="34"><span>${esc(site.name)}</span></a>
    <nav class="nav" aria-label="Main">${navLinks}</nav>
    <button class="mode" id="modeBtn" type="button" hidden>Dark</button>
    <details class="menu"><summary>Menu</summary><nav class="menu-panel" aria-label="Main"><a href="${href("")}">Home</a>${navLinks}</nav></details>
  </div>
</header>
<main id="main">
${body.replace(/\{\{pre\}\}/g, pre)}
</main>
${footer(pre, href)}
<script src="${pre}assets/js/site.js" defer></script>
</body>
</html>
`;
}

function footer(pre, href) {
  return `<footer class="site-foot" id="contact">
  ${ROSETTE.replace(/\{\{pre\}\}/g, pre)}
  <div class="wrap">
    <div class="foot-main">
      <div>
        <h2>Contact</h2>
        <p>Write to Professor Mittal at Campus Law Centre, or by email.</p>
      </div>
      <div>
        <p class="lbl">Address</p>
        <address>${site.address.map(esc).join("<br>")}</address>
      </div>
      <div>
        <p class="lbl">Email</p>
        <ul>
          ${site.emails.map(e => `<li><a class="mail" href="mailto:${esc(e)}">${esc(e)}</a></li>`).join("\n          ")}
          ${site.linkedin ? `<li style="margin-top:14px"><a class="more-link" style="color:var(--gold-hi)" href="${esc(site.linkedin)}" rel="noopener me">LinkedIn profile</a></li>` : ""}
        </ul>
      </div>
    </div>
    <div class="foot-bar">
      <span class="seal"><img src="${pre}assets/img/favicon.svg" alt="" width="28" height="28">© ${new Date().getFullYear()} ${esc(site.name)}</span>
      <nav aria-label="Footer"><a href="${href("")}">Home</a>${NAV.filter(n => !n[0].startsWith("#")).map(([t, l]) => `<a href="${href(t)}">${l}</a>`).join("")}<a href="${pre}poetry/feed.xml">New poems (RSS)</a><a href="${pre}admin/" rel="nofollow">Site admin</a></nav>
    </div>
  </div>
</footer>`;
}

const personLD = () => ({
  "@type": "Person", "@id": abs("#person") || undefined, name: site.name, jobTitle: site.role,
  worksFor: { "@type": "CollegeOrUniversity", name: site.affiliation, url: site.affiliationUrl },
  url: SITE_URL || undefined, image: photo && SITE_URL ? abs(photo) : undefined,
  email: site.emails[0] ? "mailto:" + site.emails[0] : undefined,
  knowsAbout: site.interests, sameAs: [site.linkedin].filter(Boolean),
  description: site.description
});
const authorRef = () => SITE_URL ? { "@type": "Person", "@id": abs("#person"), name: site.name, url: SITE_URL } : { "@type": "Person", name: site.name };
const crumbsLD = items => ({
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, p], i) => ({ "@type": "ListItem", position: i + 1, name, item: abs(p) || undefined }))
});
const crumbsHTML = (items, linkAll = false) => `<nav class="crumbs" aria-label="Breadcrumb">${items.map(([n, p], i) => linkAll || i < items.length - 1 ? `<a href="{{pre}}${p}">${esc(n)}</a>` : `<span aria-current="page">${esc(n)}</span>`).join('<span class="sep" aria-hidden="true">/</span>')}</nav>`;
const rolBook = books.find(b => b.slug === "the-rhythm-of-law");
const ROL_PATH = "research/books/the-rhythm-of-law/";
const randomList = () => esc(JSON.stringify((withText.length ? withText : ordered).map(p => "{{pre}}" + p.path)));
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const cloth = (b, i) => {
  const c = "c" + (Number(b.cloth) || (i % 5) + 1);
  const src = b.cover && (/^https?:\/\//.test(b.cover) ? b.cover : exists(b.cover) ? "{{pre}}" + b.cover : "");
  if (src) return `<div class="cover-img photo"><img src="${esc(src)}" alt="Cover of ${esc(b.title)}" loading="lazy" width="400" height="600"></div>`;
  return `<div class="cloth ${c}" aria-hidden="true"><span class="ft">${esc(b.title.split(":")[0])}</span><span class="fr"></span><span class="fa">${esc(site.name)}</span></div>`;
};
const medal = (t, variant = "ink", extra = "") => `<img class="medal" src="{{pre}}assets/img/medal/${t.key}-${variant}.svg" alt="" aria-hidden="true" decoding="async" ${extra}>`;
const pdfHref = a => !a.pdf ? "" : /^https?:\/\//.test(a.pdf) ? a.pdf : "{{pre}}" + a.pdf;
const bookHref = b => b.page || `research/books/#${b.slug}`;
const tocItems = list => list.map((p, i) => `<li data-title="${esc(p.title.toLowerCase())}"><a href="{{pre}}${p.path}"><span class="t">${esc(p.title)}${p.isNew ? '<span class="new">New</span>' : ""}</span><span class="lead" aria-hidden="true"></span><span class="n">${i + 1}</span>${p.text ? `<span class="x">${esc(firstLine(p.text))}</span>` : ""}</a></li>`).join("\n    ");
const shareBlock = (text, what) => `<section class="share" data-text="${esc(text)}" aria-labelledby="shareH" hidden>
    <h2 id="shareH">Share this ${what}</h2>
    <div class="row">
      <button type="button" class="native" hidden>Share</button>
      <a data-share="whatsapp" href="#" rel="noopener">WhatsApp</a>
      <a data-share="facebook" href="#" rel="noopener">Facebook</a>
      <a data-share="x" href="#" rel="noopener">X</a>
      <a data-share="linkedin" href="#" rel="noopener">LinkedIn</a>
      <a data-share="telegram" href="#" rel="noopener">Telegram</a>
      <a data-share="email" href="#">Email</a>
      <button type="button" data-copy="url" data-msg="Link copied." data-status="shareStatus">Copy link</button>
    </div>
    <p class="status" role="status" id="shareStatus"></p>
  </section>`;
const phead = (inner, cls = "") => `<section class="phead ${cls}">${ROSETTE}<div class="wrap">${inner}</div></section>`;

/* ---------- pages ---------- */
const pages = [];
const add = (p, html) => pages.push([p, html]);

/* Home / cover */
{
  const pairs = (themeBy["relationship-between-law-and-justice"]?.poems || [])
    .map(p => { const m = p.title.match(/^(\S+) and (\S+)$/); return m && { l: m[1], r: m[2], href: "{{pre}}" + p.path, title: p.title }; }).filter(Boolean);
  const words = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen"];
  const recent = ordered.filter(p => p.isNew).sort((a, b) => b.added.localeCompare(a.added));
  const [first, ...rest] = site.name.split(" ");
  const body = `
<section class="cover" aria-labelledby="name">
  <div class="wrap">
    <div class="text">
      <p class="role rise">${esc(site.role)}</p>
      <h1 id="name" class="rise"><span>${esc(first)}</span> <span>${esc(rest.join(" "))}</span></h1>
      <p class="aff rise"><a href="${esc(site.affiliationUrl)}" rel="noopener">${esc(site.affiliation)}</a></p>
      <p class="tag rise">${esc(site.tagline)}</p>
      <div class="actions rise">
        <a class="btn btn-shirt" href="{{pre}}poetry/">Read the poetry</a>
        <a class="btn btn-line" href="#about">About Professor Mittal</a>
      </div>
    </div>
    <figure class="figure${cutout ? "" : " framed"}">
      <span class="glow" aria-hidden="true"></span>
      <svg class="niche" viewBox="0 0 400 560" aria-hidden="true" preserveAspectRatio="xMidYMax meet"><path d="M14 560V196A186 186 0 0 1 386 196V560"/><path d="M34 560V196A166 166 0 0 1 366 196V560"/></svg>
      ${cutout ? `<picture><source srcset="{{pre}}${esc(cutout)}" type="image/webp"><img class="person" src="{{pre}}${esc(cutoutPng || photo)}" alt="Professor ${esc(site.name)} speaking at a lecture" width="920" height="653" fetchpriority="high"></picture>` : photo ? picture(photo, photoWebp, `Professor ${site.name}`, 'class="person" width="720" height="900"') : ""}
    </figure>
  </div>
  <div class="cover-quote"><div class="wrap"><p>“I often find my expression in the form of poetry.”<cite>${esc(site.name)}</cite></p></div></div>
</section>

<section class="section" id="about" aria-labelledby="aboutTitle">
  <div class="wrap">
    <div class="about">
      <aside>
        <h2 id="aboutTitle">About</h2>
        <p>${esc(site.role)}, ${esc(site.affiliation)}.</p>
        <ul class="interests" aria-label="Research interests">${site.interests.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      </aside>
      <div>
        ${site.bio.map((b, i) => `<p${i ? "" : ' class="lead"'}>${b}</p>`).join("\n        ")}
        ${lecture ? `<figure class="lecture">${picture(lecture, lectureWebp, `Professor ${site.name} delivering a lecture`, 'width="950" height="683" loading="lazy"')}</figure>` : ""}
        <div class="service">
          ${site.service.map(s => `<div><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></div>`).join("\n          ")}
        </div>
      </div>
    </div>
    <div class="visits">
      <div class="intro"><h3>Academic visitor</h3><p>${esc(site.visitsIntro)}</p></div>
      <ul class="inst">${site.visits.map(v => `<li>${esc(v)}</li>`).join("")}</ul>
    </div>
  </div>
</section>

<section class="section feature on-dark" aria-labelledby="poetryTitle">
  ${ROSETTE}
  <div class="wrap">
    <div>
      <p class="kicker">Poetry</p>
      <h2 id="poetryTitle">The Rhythm of Law</h2>
      <p>${ordered.length} poems on truth, justice, duty, nature, creativity, life and love. ${recent.length ? `New: ${recent.slice(0, 3).map(p => `<a href="{{pre}}${p.path}">${esc(p.title)}</a>`).join(", ")}.` : `Most are collected in <em>The Rhythm of Law</em> (${esc(rolBook?.publisher || "")}, ${rolBook?.year || ""}).`}</p>
      ${pairs.length ? `<div class="analogy" data-pairs="${esc(JSON.stringify(pairs))}">
        <div class="arow"><span class="l">Law</span><span class="c">:</span><span class="r">Justice</span></div>
        <div class="arow sep" aria-hidden="true"><span class="l"></span><span class="c">::</span><span class="r"></span></div>
        <a class="arow" id="pairLink" href="${pairs[0].href}" aria-label="Read the poem ${esc(pairs[0].title)}"><span class="l" id="pairL">${esc(pairs[0].l)}</span><span class="c">:</span><span class="r" id="pairR">${esc(pairs[0].r)}</span></a>
      </div>
      <p style="font-size:1rem">${words[pairs.length] || pairs.length} poems picture law and justice as a pair. Select the pair to read that poem. <button class="linkbtn" id="pairNext" type="button" hidden>Show another pair</button></p>` : ""}
    </div>
    <div>
      <ol class="contents">${usedThemes.map((t, i) => `<li><a href="{{pre}}${t.path}">${medal(t, "light")}<span class="num">${roman(i + 1)}</span><span class="nm">${esc(t.name)}</span><span class="lead" aria-hidden="true"></span><span class="ct">${t.poems.length}</span></a></li>`).join("")}</ol>
      <div class="actions"><a class="btn btn-shirt" href="{{pre}}poetry/">Read all ${ordered.length} poems</a><button class="btn btn-line" type="button" data-random="${randomList()}" hidden>A poem at random</button></div>
    </div>
  </div>
</section>

<section class="section shelf-sec" aria-labelledby="booksTitle">
  <div class="wrap">
    <div class="sec-head"><h2 id="booksTitle">Books</h2><a class="more-link" href="{{pre}}research/books/">All books</a></div>
    <ul class="shelf">${books.map((b, i) => `<li><a href="{{pre}}${bookHref(b)}">${cloth(b, i)}<p class="bk-t">${esc(b.title)}</p><p class="bk-m">${esc(b.publisher)}, ${b.year}</p></a></li>`).join("")}</ul>
  </div>
</section>

<section class="section" aria-labelledby="artTitle">
  <div class="wrap">
    <div class="sec-head"><h2 id="artTitle">Research articles</h2><a class="more-link" href="{{pre}}research/articles/">All articles</a></div>
    ${articleList()}
  </div>
</section>`;
  add("", shell({
    p: "", navKey: "", title: `${site.name}: ${site.role}, University of Delhi, and poet`,
    description: site.description, body,
    ld: [personLD(), { "@type": "WebSite", name: site.name, url: SITE_URL || undefined, author: authorRef() }]
  }));
}

function articleList() {
  return `<ul class="articles">
    ${articles.map(a => `<li><span class="yr">${a.year} · <em>${esc(a.journal)}</em></span><div>
      <h3><a href="{{pre}}research/articles/${a.slug}/">${esc(a.title)}</a></h3>
      <p class="meta">${esc(a.authors.join(" and "))}. Vol. ${esc(a.volume)}${a.issue ? `, No. ${esc(a.issue)}` : ""}, pp. ${esc(a.pages)}.</p>
    </div><div class="lk"><a href="{{pre}}research/articles/${a.slug}/">${a.abstract ? "Abstract" : "Summary"}</a>${a.pdf ? `<a href="${esc(pdfHref(a))}" rel="noopener">PDF</a>` : ""}</div></li>`).join("\n    ")}
  </ul>`;
}

/* Poetry index */
{
  const recent = ordered.filter(p => p.isNew).sort((a, b) => b.added.localeCompare(a.added)).slice(0, 6);
  const chapters = usedThemes.map((t, i) => `
<section class="chapter" id="${t.key}" aria-labelledby="h-${t.key}">
  <header>
    ${medal(t, "ink")}
    <span class="rn">Part ${roman(i + 1)}</span>
    <h2 id="h-${t.key}"><a href="{{pre}}${t.path}">${esc(t.name)}</a></h2>
    <span class="cnt">${plural(t.poems.length, "poem")}</span>
  </header>
  <ol class="toc">
    ${tocItems(t.poems)}
  </ol>
</section>`).join("");
  const body = `
${phead(`${crumbsHTML([["Home", ""], ["Poetry", "poetry/"]])}
  <h1>Poetry</h1>
  <p class="lede">${ordered.length} poems by ${esc(site.name)} on truth, justice, duty, nature, creativity, life and love. Most are collected in <a href="{{pre}}${ROL_PATH}"><em>The Rhythm of Law</em></a> (${esc(rolBook?.publisher || "")}, ${rolBook?.year || ""}).</p>
  <div class="tools">
    <label class="search" hidden><span class="vh">Search poems by title</span><input type="search" id="q" placeholder="Search by title" autocomplete="off"></label>
    <button class="btn btn-line" type="button" data-random="${randomList()}" hidden>A poem at random</button>
  </div>`)}
<div class="themebar"><div class="wrap"><nav aria-label="Themes">${usedThemes.map((t, i) => `<a href="#${t.key}"><b>${roman(i + 1)}</b>${esc(t.short || t.name)}</a>`).join("")}</nav></div></div>
<div class="wrap">
  ${recent.length ? `<div class="latest"><h2>Recently added</h2><ul>${recent.map(p => `<li><a href="{{pre}}${p.path}">${esc(p.title)}</a><span class="d">${fmtDate(p.added)}</span></li>`).join("")}</ul></div>` : ""}
  ${chapters}
  <p class="empty" id="emptyMsg" hidden>No poem titles match “<span id="emptyQ"></span>”. <button class="linkbtn" type="button" id="clearQ">Clear the search</button></p>
</div>`;
  add("poetry/", shell({
    p: "poetry/", navKey: "poetry/", title: `Poetry: poems on law, justice and life by ${site.name}`,
    description: `Read ${ordered.length} poems by ${site.name} on truth, justice, the relationship between law and justice, duties and rights, environment, intellectual property, life and love.`,
    body,
    ld: [crumbsLD([["Home", ""], ["Poetry", "poetry/"]]), {
      "@type": "CollectionPage", name: "Poetry", url: abs("poetry/") || undefined, author: authorRef(),
      hasPart: ordered.map(p => ({ "@type": "CreativeWork", name: p.title, url: abs(p.path) || undefined }))
    }]
  }));
  add("poetry/the-rhythm-of-law/", redirect(ROL_PATH));
}

/* Theme pages */
usedThemes.forEach((t, i) => {
  const prev = usedThemes[i - 1], next = usedThemes[i + 1];
  const items = [["Home", ""], ["Poetry", "poetry/"], [t.name, t.path]];
  const body = `
${phead(`<div>${crumbsHTML(items)}
  <p class="num">Part ${roman(i + 1)}</p>
  <h1>${esc(t.name)}</h1>
  <p class="lede">${plural(t.poems.length, "poem")} by ${esc(site.name)}${t.description ? ". " + esc(t.description) : "."}</p></div>${medal(t, "light")}`, "with-medal")}
<div class="wrap">
  <section class="chapter" aria-label="Poems">
    <header>${medal(t, "ink")}<span class="rn">Part ${roman(i + 1)}</span><span class="cnt">${plural(t.poems.length, "poem")}</span></header>
    <ol class="toc">
    ${tocItems(t.poems)}
    </ol>
  </section>
  <nav class="pager" aria-label="Other themes">
    ${prev ? `<a class="prev" href="{{pre}}${prev.path}"><small>Previous theme</small><span>${esc(prev.name)}</span></a>` : ""}
    ${next ? `<a class="next" href="{{pre}}${next.path}"><small>Next theme</small><span>${esc(next.name)}</span></a>` : ""}
  </nav>
</div>`;
  add(t.path, shell({
    p: t.path, navKey: "poetry/", title: `Poems on ${t.name} by ${site.name}`,
    description: `${plural(t.poems.length, "poem")} on ${t.name.toLowerCase()} by ${site.name}: ${t.poems.slice(0, 5).map(p => p.title).join(", ")}${t.poems.length > 5 ? " and more" : ""}.`,
    body, ld: [crumbsLD(items), {
      "@type": "CollectionPage", name: `Poems on ${t.name}`, url: abs(t.path) || undefined, author: authorRef(),
      hasPart: t.poems.map(p => ({ "@type": "CreativeWork", name: p.title, url: abs(p.path) || undefined }))
    }]
  }));
});

/* Poem pages */
ordered.forEach((p, i) => {
  const prev = ordered[i - 1], next = ordered[i + 1];
  const t = p.theme, ti = usedThemes.indexOf(t);
  const items = [["Home", ""], ["Poetry", "poetry/"], [t.name, t.path], [p.title, p.path]];
  const inBook = p.book && /rhythm of law/i.test(p.book);
  const img = p.image && exists(p.image) ? p.image : "";
  const bodyHTML = p.text
    ? `<div class="poem-wrap"><div class="poem">\n${stanzas(p.text)}\n</div></div>\n  <div class="fleuron" aria-hidden="true"><i></i></div>`
    : `<div class="awaiting">${medal(t, "ink")}<p>This poem will be published here soon.</p><a class="btn btn-out" href="{{pre}}${t.path}">More poems on ${esc(t.name)}</a></div>`;
  const desc = `Read “${p.title}”, a poem by ${site.name} on ${t.name.toLowerCase()}${inBook ? ", from The Rhythm of Law" : ""}.${p.text ? ` It begins: “${firstLine(p.text)}”` : ""}`;
  const body = `
<header class="poem-band">
  ${ROSETTE}
  <div class="in">
    ${crumbsHTML(items.slice(0, 3), true)}
    ${medal(t, "light")}
    <p class="theme"><a href="{{pre}}${t.path}">${esc(t.name)}</a></p>
    <h1 id="poemTitle">${esc(p.title)}</h1>
    <p class="by">${esc(site.name)}${inBook ? `, from <a href="{{pre}}${ROL_PATH}"><em>The Rhythm of Law</em></a>` : p.added ? `, ${fmtDate(p.added)}` : ""}</p>
  </div>
</header>
<article class="reader" aria-labelledby="poemTitle">
  <div class="rbar">
    <span>Part ${roman(ti + 1)}, poem ${t.poems.indexOf(p) + 1} of ${t.poems.length}</span>
    <span class="sz" hidden><span class="vh">Text size</span><button class="tbtn" type="button" data-size="-1" aria-label="Smaller text">A−</button><button class="tbtn" type="button" data-size="1" aria-label="Larger text">A+</button></span>
  </div>
  ${img ? `<figure class="poem-img"><img src="{{pre}}${esc(img)}" alt="" loading="lazy"></figure>` : ""}
  ${bodyHTML}
  ${p.note ? `<p class="by" style="text-align:center;color:var(--ink-soft)">${esc(p.note)}</p>` : ""}
  ${shareBlock(`“${p.title}”, a poem by ${site.name}`, "poem")}
</article>
<div class="reader-foot">
  <nav class="pager" aria-label="Previous and next poem" style="padding-bottom:56px">
    ${prev ? `<a class="prev" href="{{pre}}${prev.path}" rel="prev"><small>Previous poem</small><span>${esc(prev.title)}</span></a>` : ""}
    ${next ? `<a class="next" href="{{pre}}${next.path}" rel="next"><small>Next poem</small><span>${esc(next.title)}</span></a>` : ""}
  </nav>
  <section class="siblings" aria-labelledby="moreH">
    <h2 id="moreH">More poems on ${esc(t.name)}</h2>
    <ul>${t.poems.filter(x => x !== p).map(x => `<li><a href="{{pre}}${x.path}">${esc(x.title)}</a></li>`).join("")}</ul>
    <p style="margin-top:32px"><a class="more-link" href="{{pre}}poetry/">All ${ordered.length} poems</a></p>
  </section>
</div>`;
  const work = {
    "@type": "CreativeWork", genre: "Poetry", name: p.title, headline: p.title, inLanguage: "en",
    url: abs(p.path) || undefined, author: authorRef(), about: t.name,
    datePublished: p.added || (inBook ? String(rolBook?.year || "") : undefined) || undefined,
    image: img && SITE_URL ? abs(img) : undefined,
    isPartOf: inBook ? { "@type": "Book", name: "The Rhythm of Law", isbn: rolBook?.isbn || undefined, url: abs(ROL_PATH) || undefined } : undefined
  };
  add(p.path, shell({ p: p.path, noindex: !p.text, navKey: "poetry/", type: "article", title: `${p.title}, a poem by ${site.name}`, description: desc, body, image: img, ld: [crumbsLD(items), work] }));
});

/* Research overview (old /research page) */
add("research/", shell({
  p: "research/", navKey: "research/books/", title: `Research by ${site.name}`,
  description: `Books and research articles by ${site.name} on intellectual property, copyright, licensing, legal aid, duties, and law and spirituality.`,
  body: `
${phead(`${crumbsHTML([["Home", ""], ["Research", "research/"]])}<h1>Research</h1><p class="lede">Intellectual property, contract, licensing, banking and insurance law, and the meeting of law, literature and religion.</p>`)}
<div class="wrap section">
  <div class="split">
    <div><h2><a href="{{pre}}research/books/">Books</a></h2>
      <ul class="plain">${books.map(b => `<li><a href="{{pre}}${bookHref(b)}">${esc(b.title)}</a><small>${b.year}</small></li>`).join("")}</ul></div>
    <div><h2><a href="{{pre}}research/articles/">Articles</a></h2>
      <ul class="plain">${articles.map(a => `<li><a href="{{pre}}research/articles/${a.slug}/">${esc(a.title)}</a><small>${a.year}</small></li>`).join("")}</ul></div>
  </div>
</div>`,
  ld: [crumbsLD([["Home", ""], ["Research", "research/"]])]
}));

/* Books */
{
  const items = [["Home", ""], ["Research", "research/"], ["Books", "research/books/"]];
  const body = `
${phead(`${crumbsHTML(items)}<h1>Books</h1><p class="lede">Books written and edited by ${esc(site.name)}, from intellectual property licensing to legal aid, duties, spirituality and poetry.</p>`)}
<div class="wrap">
  <ul class="booklist" style="margin-bottom:64px">
    ${books.map((b, i) => `<li id="${b.slug}">${b.page ? `<a href="{{pre}}${b.page}" tabindex="-1" aria-hidden="true">${cloth(b, i)}</a>` : cloth(b, i)}<div>
      <p class="yr">${b.year}</p>
      <h2>${b.page ? `<a href="{{pre}}${b.page}">${esc(b.title)}</a>` : esc(b.title)}</h2>
      <p class="cr">${esc(b.credit)}</p>
      <p class="pb">${esc(b.publisher)}, ${b.year}${b.isbn ? `. ISBN ${esc(b.isbn)}` : ""}</p>
      <div class="actions">${b.page ? `<a class="btn btn-ink" href="{{pre}}${b.page}">About the book</a>` : ""}${b.links.map(([l, u], j) => `<a class="btn ${b.page || j ? "btn-out" : "btn-ink"}" href="${esc(u)}" rel="noopener">${esc(l)}</a>`).join("")}</div>
    </div></li>`).join("\n    ")}
  </ul>
</div>`;
  add("research/books/", shell({
    p: "research/books/", navKey: "research/books/", title: `Books by ${site.name}`,
    description: `Books by ${site.name}: ${books.map(b => `${b.title} (${b.year})`).join("; ")}.`,
    body, ld: [crumbsLD(items), ...books.map(b => ({
      "@type": "Book", name: b.title, isbn: b.isbn || undefined, datePublished: String(b.year),
      publisher: { "@type": "Organization", name: b.publisher },
      author: b.authors ? b.authors.map(n => n === site.name ? authorRef() : { "@type": "Person", name: n }) : undefined,
      editor: b.editors ? b.editors.map(n => n === site.name ? authorRef() : { "@type": "Person", name: n }) : undefined,
      genre: b.slug === "the-rhythm-of-law" ? "Poetry" : undefined,
      url: abs(b.page || "research/books/") || undefined, sameAs: b.links.map(l => l[1])
    }))]
  }));
}

/* The Rhythm of Law */
if (rolBook) {
  const items = [["Home", ""], ["Research", "research/"], ["Books", "research/books/"], ["The Rhythm of Law", ROL_PATH]];
  const bookPoems = usedThemes.map(t => ({ t, list: t.poems.filter(p => /rhythm of law/i.test(p.book)) })).filter(x => x.list.length);
  const count = bookPoems.reduce((n, x) => n + x.list.length, 0);
  const body = `
${phead(`${crumbsHTML(items)}
  <div class="rol">
    ${cloth({ ...rolBook, cloth: 1 }, 0)}
    <div>
      <h1>The Rhythm of Law</h1>
      <p class="lede">Poems by ${esc(site.name)}: ${count} poems in ${bookPoems.length} parts, from truth and justice to duties, the environment, intellectual property, life and love.</p>
      <p class="pub" style="margin-top:18px">${esc(rolBook.publisher)}, ${rolBook.year}${rolBook.isbn ? `. ISBN ${esc(rolBook.isbn)}` : ""}</p>
      <div class="actions">${rolBook.links.map(([l, u], i) => `<a class="btn ${i ? "btn-line" : "btn-gold"}" href="${esc(u)}" rel="noopener">${esc(l)}</a>`).join("")}<a class="btn btn-line" href="#contents">Contents</a></div>
      <blockquote>I am also interested in exploring the interaction between law, literature and religion. I often find my expression in the form of poetry.<cite>${esc(site.name)}</cite></blockquote>
    </div>
  </div>`)}
<div class="wrap" id="contents">
  ${bookPoems.map(({ t, list }, i) => `
  <section class="chapter" aria-labelledby="c-${t.key}">
    <header>${medal(t, "ink")}<span class="rn">Part ${roman(i + 1)}</span><h2 id="c-${t.key}"><a href="{{pre}}${t.path}">${esc(t.name)}</a></h2><span class="cnt">${plural(list.length, "poem")}</span></header>
    <ol class="toc">${tocItems(list)}</ol>
  </section>`).join("")}
  <div style="height:48px"></div>
</div>`;
  add(ROL_PATH, shell({
    p: ROL_PATH, navKey: ROL_PATH, title: `The Rhythm of Law: poems by ${site.name}`,
    description: `The Rhythm of Law (${rolBook.publisher}, ${rolBook.year}) by ${site.name}: ${count} poems on truth, justice, the relationship between law and justice, duties and rights, environment, intellectual property, life and love.`,
    body, ld: [crumbsLD(items), {
      "@type": "Book", name: "The Rhythm of Law", genre: "Poetry", isbn: rolBook.isbn || undefined,
      datePublished: String(rolBook.year), publisher: { "@type": "Organization", name: rolBook.publisher },
      author: authorRef(), url: abs(ROL_PATH) || undefined, sameAs: rolBook.links.map(l => l[1]),
      hasPart: bookPoems.flatMap(x => x.list).map(p => ({ "@type": "CreativeWork", name: p.title, url: abs(p.path) || undefined }))
    }]
  }));
}

/* Articles */
{
  const items = [["Home", ""], ["Research", "research/"], ["Articles", "research/articles/"]];
  const body = `
${phead(`${crumbsHTML(items)}<h1>Research articles</h1><p class="lede">Each article has its own page with a summary, keywords, DOI and a citation you can copy.</p>`)}
<div class="wrap section" style="padding-top:56px">
  ${articleList()}
</div>`;
  add("research/articles/", shell({
    p: "research/articles/", navKey: "research/articles/", title: `Research articles by ${site.name}`,
    description: `Research articles by ${site.name}: ${articles.map(a => a.title).join("; ")}.`, body, ld: [crumbsLD(items)]
  }));

  articles.forEach(a => {
    const p = `research/articles/${a.slug}/`;
    const it = [...items, [a.title, p]];
    const isAbs = !!a.abstract;
    const text = (isAbs ? a.abstract : a.summary) || "";
    const body = `
<article class="paper" aria-labelledby="artTitle">
  ${crumbsHTML(it.slice(1, 3), true).replace('class="crumbs"', 'class="crumbs" style="color:var(--ink-soft)"')}
  <p class="jr">${esc(a.journal)}, ${esc(a.dateLabel)}</p>
  <h1 id="artTitle">${esc(a.title)}</h1>
  <p class="au">${esc(a.authors.join(" and "))}</p>
  <dl class="meta-t">
    <dt>Journal</dt><dd><em>${esc(a.journal)}</em></dd>
    <dt>Issue</dt><dd>Vol. ${esc(a.volume)}${a.issue ? `, No. ${esc(a.issue)}` : ""}, pp. ${esc(a.pages)}</dd>
    <dt>Published</dt><dd>${esc(a.dateLabel)}</dd>
    ${a.doi ? `<dt>DOI</dt><dd><a href="https://doi.org/${esc(a.doi)}" rel="noopener">${esc(a.doi)}</a></dd>` : ""}
  </dl>
  <h2>${isAbs ? "Abstract" : "Summary"}</h2>
  <div class="body">${text.split(/\n\s*\n/).map(x => `<p>${esc(x)}</p>`).join("")}</div>
  <h2>Keywords</h2>
  <ul class="kw">${(a.keywords || []).map(k => `<li>${esc(k)}</li>`).join("")}</ul>
  ${a.citation ? `<h2>How to cite</h2>
  <p class="cite">${esc(a.citation)}</p>
  <button class="tbtn" type="button" data-copy="${esc(a.citation)}" data-msg="Citation copied." data-status="citeStatus" hidden>Copy citation</button>
  <p class="status" role="status" id="citeStatus"></p>` : ""}
  <div class="actions">
    ${a.pdf ? `<a class="btn btn-ink" href="${esc(pdfHref(a))}" rel="noopener">Read the full article (PDF)</a>` : ""}
    ${a.page ? `<a class="btn btn-out" href="${esc(a.page)}" rel="noopener">Journal page</a>` : ""}
  </div>
  ${shareBlock(`${a.title}, by ${a.authors.join(" and ")}`, "article")}
</article>`;
    add(p, shell({
      p, navKey: "research/articles/", type: "article", title: `${a.title}, by ${a.authors.join(" and ")}`,
      description: (text.length > 155 ? text.slice(0, 152).replace(/\s+\S*$/, "") + "…" : text), body,
      ld: [crumbsLD(it), {
        "@type": "ScholarlyArticle", headline: a.title, name: a.title,
        author: a.authors.map(n => n === site.name ? authorRef() : { "@type": "Person", name: n }),
        datePublished: String(a.datePublished || a.year), keywords: (a.keywords || []).join(", "), abstract: a.abstract || undefined, description: a.summary,
        identifier: a.doi ? { "@type": "PropertyValue", propertyID: "DOI", value: a.doi } : undefined, sameAs: a.doi ? "https://doi.org/" + a.doi : undefined,
        url: abs(p) || undefined,
        isPartOf: { "@type": "PublicationIssue", issueNumber: a.issue || undefined, isPartOf: { "@type": "Periodical", name: a.journal, volumeNumber: a.volume } },
        pagination: a.pages
      }]
    }));
  });
}

/* 404 */
add("404.html", shell({
  p: "404.html", fixedRoot: true, noindex: true, title: `Page not found | ${site.name}`, description: "This page could not be found.",
  body: phead(`<h1>Page not found</h1><p class="lede">The page may have moved when this website replaced the old one.</p><div class="actions" style="margin-top:32px"><a class="btn btn-shirt" href="{{pre}}poetry/">Browse the poems</a><a class="btn btn-line" href="{{pre}}">Home page</a></div>`)
}));

function redirect(to) {
  const target = abs(to);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Moved</title>${target ? `<link rel="canonical" href="${esc(target)}">` : ""}<meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=../../${to}"></head><body><p><a href="../../${to}">This page has moved.</a></p></body></html>`;
}

/* ---------- write ---------- */
fs.rmSync(OUT, { recursive: true, force: true });
for (const [p, html] of pages) {
  const file = p.endsWith(".html") ? path.join(OUT, p) : path.join(OUT, p, "index.html");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}
fs.cpSync(path.join(ROOT, "assets"), path.join(OUT, "assets"), { recursive: true });
fs.mkdirSync(path.join(OUT, "assets/img/medal"), { recursive: true });
themes.forEach((t, i) => {
  const seed = themes.indexOf(t);
  fs.writeFileSync(path.join(OUT, `assets/img/medal/${t.key}-light.svg`), medallion(seed, "#9AA3F0"));
  fs.writeFileSync(path.join(OUT, `assets/img/medal/${t.key}-ink.svg`), medallion(seed, "#4A52B8"));
});
if (fs.existsSync(path.join(ROOT, "admin"))) {
  fs.cpSync(path.join(ROOT, "admin"), path.join(OUT, "admin"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "admin", "config.json"), JSON.stringify({ repo: (site.admin && site.admin.repo) || "", branch: (site.admin && site.admin.branch) || "main" }) + "\n");
}
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
// Cloudflare Pages / Netlify: permanent redirects for old Google Sites addresses
fs.writeFileSync(path.join(OUT, "_redirects"), [
  "/home / 301", "/home/ / 301", "/teaching / 301", "/teaching/* / 301",
  `/poetry/the-rhythm-of-law /${ROL_PATH} 301`, `/poetry/the-rhythm-of-law/ /${ROL_PATH} 301`
].join("\n") + "\n");
// Cloudflare Pages / Netlify: response headers. A preview build (--preview) also asks search engines not to index it yet.
const PREVIEW = process.argv.includes("--preview");
fs.writeFileSync(path.join(OUT, "_headers"), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
${PREVIEW ? "  X-Robots-Tag: noindex\n" : ""}
/assets/*
  Cache-Control: public, max-age=86400
`);
if (PREVIEW) warnings.push("Preview build: every page is marked noindex. Build without --preview when the site goes live.");
if (site.domain) fs.writeFileSync(path.join(OUT, "CNAME"), site.domain + "\n");

const emptyPoems = new Set(ordered.filter(p => !p.text).map(p => p.path));
const indexable = pages.map(p => p[0]).filter(p => !p.endsWith(".html") && p !== "poetry/the-rhythm-of-law/" && !emptyPoems.has(p));
if (SITE_URL) {
  const lastmod = p => { const poem = ordered.find(x => x.path === p); if (poem) { const st = fs.statSync(path.join(poemDir, poem.file)); return st.mtime.toISOString().slice(0, 10); } return TODAY; };
  fs.writeFileSync(path.join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexable.map(p => `  <url><loc>${esc(abs(p))}</loc><lastmod>${lastmod(p)}</lastmod></url>`).join("\n")}
</urlset>
`);
}
fs.writeFileSync(path.join(OUT, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /admin/\n${SITE_URL ? `Sitemap: ${SITE_URL}/sitemap.xml\n` : ""}`);

const feedItems = ordered.filter(p => p.added && p.text).sort((a, b) => b.added.localeCompare(a.added)).slice(0, 30);
fs.mkdirSync(path.join(OUT, "poetry"), { recursive: true });
fs.writeFileSync(path.join(OUT, "poetry", "feed.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>New poems by ${esc(site.name)}</title>
  <link>${esc(abs("poetry/"))}</link>
  <description>New poems by ${esc(site.name)}</description>
  <language>en</language>
${feedItems.map(p => `  <item>
    <title>${esc(p.title)}</title>
    <link>${esc(abs(p.path))}</link>
    <guid>${esc(abs(p.path) || p.slug)}</guid>
    <pubDate>${new Date(p.added + "T09:00:00+05:30").toUTCString()}</pubDate>
    <category>${esc(p.theme.name)}</category>
    <description>${esc(p.text.split("\n").slice(0, 4).join(" / "))}</description>
  </item>`).join("\n")}
</channel>
</rss>
`);

console.log(`Built ${pages.length} pages (${ordered.length} poems, ${withText.length} with text) into dist/`);
for (const w of warnings) console.log("  note: " + w);
