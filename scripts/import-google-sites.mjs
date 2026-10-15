#!/usr/bin/env node
/*
  Migration from the old Google Site. Runs from the admin page's "Import" tab
  (as a GitHub Actions workflow), or on a computer:

    npm install
    node scripts/import-google-sites.mjs --what=poems            # fill in every poem that has no text
    node scripts/import-google-sites.mjs --what=poems --only=string-and-kite --dry
    node scripts/import-google-sites.mjs --what=covers           # find book covers by ISBN / Amazon link

  Poems that already have text are never overwritten (unless --force).
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "node-html-parser";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = f => path.join(ROOT, "content", f);
const site = JSON.parse(fs.readFileSync(C("site.json"), "utf8"));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const WHAT = String(args.what || "poems");
if (!["poems", "covers", "all"].includes(WHAT)) { console.error(`Unknown --what=${WHAT}. Use poems, covers or all.`); process.exit(1); }
const DRY = !!args.dry, FORCE = !!args.force, ONLY = args.only ? String(args.only).split(",") : null;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const BOILER = /^(search this site|embedded files|skip to main content|skip to navigation|report abuse|page details|page updated|google sites|this site uses cookies.*)$/i;
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, accept) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9", ...(accept ? { Accept: accept } : {}) }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

export function extractPoem(html, title) {
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false } });
  const main = root.querySelector('[role="main"]') || root.querySelector("main") || root.querySelector("body") || root;
  main.querySelectorAll('nav, [role="navigation"], header[role="banner"], footer, script, style, noscript').forEach(n => n.remove());
  const BLOCK = "p, h1, h2, h3, h4, h5, h6, li";
  const lines = [];
  for (const b of main.querySelectorAll(BLOCK)) {
    if (b.parentNode && b.parentNode.closest && b.parentNode.closest(BLOCK)) continue;
    const text = parse(b.innerHTML.replace(/<br\s*\/?>/gi, "\n")).text
      .replace(/ /g, " ").split("\n").map(l => l.trim()).join("\n");
    const t = text.trim();
    if (/^h[1-6]$/i.test(b.rawTagName) && norm(t) === norm(title)) continue;
    if (BOILER.test(t) || norm(t) === norm(site.name) || norm(t) === norm(`${site.name} ${title}`)) continue;
    lines.push(t);
  }
  while (lines.length && !lines[0]) lines.shift();
  if (lines.length && norm(lines[0]) === norm(title)) lines.shift();
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const images = main.querySelectorAll("img").map(i => i.getAttribute("src") || "").filter(s => /googleusercontent|sitesv-images|lh\d\.google/.test(s));
  return { text, images };
}

async function save(rel, res) {
  const buf = Buffer.from(await res.arrayBuffer());
  if (!DRY) { fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true }); fs.writeFileSync(path.join(ROOT, rel), buf); }
  return { rel, size: buf.length };
}

async function importPoems() {
  const poems = JSON.parse(fs.readFileSync(C("poems.json"), "utf8"));
  let done = 0, skipped = 0, failed = 0;
  for (const p of poems) {
    if (ONLY && !ONLY.includes(p.slug)) continue;
    if (!p.source || (p.text && !FORCE)) { skipped++; continue; }
    try {
      const html = await (await get(p.source)).text();
      const { text, images } = extractPoem(html, p.title);
      if (!text) { console.log(`✗ ${p.slug}: no text found on the page`); failed++; continue; }
      p.text = text;
      if (images[0] && !p.image) {
        try { const r = await save(`assets/img/poems/${p.slug}.jpg`, await get(images[0].replace(/=w\d+.*$/, "=w1600"))); p.image = r.rel; } catch (e) {}
      }
      const n = text.split("\n").length;
      console.log(DRY ? `\n--- ${p.slug} (${n} lines)\n${text}\n` : `✓ ${p.slug} (${n} lines)${n < 3 ? "  (very short: check it)" : n > 150 ? "  (very long: check it)" : ""}`);
      done++;
    } catch (e) { console.log(`✗ ${p.slug}: ${e.message}`); failed++; }
    await sleep(600);
  }
  if (!DRY) fs.writeFileSync(C("poems.json"), JSON.stringify(poems, null, 1) + "\n");
  console.log(`\nPoems: imported ${done}, skipped ${skipped}, failed ${failed}.`);
}

const isbn13 = i => {
  const d = String(i || "").replace(/[^0-9X]/gi, "");
  if (d.length === 13) return d;
  if (d.length !== 10) return "";
  const core = "978" + d.slice(0, 9);
  const sum = core.split("").reduce((s, c, k) => s + Number(c) * (k % 2 ? 3 : 1), 0);
  return core + ((10 - (sum % 10)) % 10);
};
async function tryCover(url, minBytes = 6000) {
  try {
    const res = await get(url, "image/*");
    const type = res.headers.get("content-type") || "";
    if (!/image\//.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length >= minBytes ? buf : null;
  } catch (e) { return null; }
}
async function findCovers() {
  const books = JSON.parse(fs.readFileSync(C("books.json"), "utf8"));
  for (const b of books) {
    if (ONLY && !ONLY.includes(b.slug)) continue;
    if (b.cover && (fs.existsSync(path.join(ROOT, b.cover)) && !FORCE)) { console.log(`= ${b.slug}: already has a cover`); continue; }
    const amazon = (b.links || []).find(l => /amazon\./.test(l[1]));
    const asin = amazon && (amazon[1].match(/\/dp\/([A-Z0-9]{10})/i) || [])[1];
    const i13 = isbn13(b.isbn);
    const gid = ((b.links || []).find(l => /books\.google/.test(l[1])) || [, ""])[1].match(/id=([\w-]+)/);
    const candidates = [];
    if (asin) candidates.push(`https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_.jpg`, `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_.jpg`);
    if (i13) candidates.push(`https://covers.openlibrary.org/b/isbn/${i13}-L.jpg?default=false`);
    let buf = null;
    for (const u of candidates) { buf = await tryCover(u); if (buf) { console.log(`✓ ${b.slug}: ${u}`); break; } }
    if (!buf) {
      // Google Books by ISBN, then by the Google Books id in the links
      const q = i13 ? `isbn:${i13}` : b.isbn ? `isbn:${b.isbn}` : "";
      const tries = [];
      if (q) tries.push(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}`);
      if (gid) tries.push(`https://www.googleapis.com/books/v1/volumes/${gid[1]}`);
      for (const api of tries) {
        try {
          const j = await (await get(api, "application/json")).json();
          const vol = j.items ? j.items[0] : j;
          const links = vol && vol.volumeInfo && vol.volumeInfo.imageLinks;
          const u = links && (links.large || links.medium || links.thumbnail);
          if (u) { buf = await tryCover(u.replace(/^http:/, "https:").replace("&edge=curl", "").replace(/zoom=\d/, "zoom=2"), 4000); if (buf) { console.log(`✓ ${b.slug}: Google Books`); break; } }
        } catch (e) {}
      }
    }
    if (!buf && amazon) {
      // Last try: read the product page for its main image
      try {
        const html = await (await get(amazon[1], "text/html")).text();
        const m = html.match(/"hiRes":"(https:[^"]+)"/) || html.match(/data-old-hires="(https:[^"]+)"/) || html.match(/id="landingImage"[^>]+src="(https:[^"]+)"/);
        if (m) { buf = await tryCover(m[1]); if (buf) console.log(`✓ ${b.slug}: Amazon page`); }
      } catch (e) {}
    }
    if (!buf) { console.log(`✗ ${b.slug}: no cover found. Upload one on the admin Books tab.`); continue; }
    const rel = `assets/img/books/${b.slug}.jpg`;
    if (!DRY) { fs.mkdirSync(path.join(ROOT, "assets/img/books"), { recursive: true }); fs.writeFileSync(path.join(ROOT, rel), buf); b.cover = rel; }
    await sleep(500);
  }
  if (!DRY) fs.writeFileSync(C("books.json"), JSON.stringify(books, null, 2) + "\n");
}

async function main() {
  if (WHAT === "poems" || WHAT === "all") await importPoems();
  if (WHAT === "covers" || WHAT === "all") await findCovers();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
