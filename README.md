# Website of Prof. Raman Mittal

A fast website built for search engines. Every poem, book and article has its
own page with a proper title, description and structured data, and appears in
`sitemap.xml`. Professor Mittal keeps it up to date from a simple **admin
page** (`/admin/`), with no code and no email.

How it fits together:

```
GitHub repository  ──►  Cloudflare Pages builds the site  ──►  www.yourdomain.in
      ▲                                                             │
      └──────────────  /admin/ page saves changes here  ◄───────────┘
```

Every save in the admin is stored in the GitHub repository. Cloudflare notices
the change and publishes the updated website, usually within a minute.

---

## 1. One-time setup (about 20 minutes, all in the web browser)

### a. Put the project on GitHub
1. Create a free account at [github.com](https://github.com) if you don't have one.
2. Click **New repository**. Name it `raman-mittal-site`, choose **Private**
   or **Public**, and create it without a README.
3. On the empty repository page click **uploading an existing file**. Unzip
   `raman-mittal-site.zip` on your computer, open the folder, select
   **everything inside it** (including the hidden `.github` folder) and drag
   it in. Click **Commit changes**.
   - If the `.github` folder didn't upload (some computers hide it): click
     **Add file → Create new file**, type `.github/workflows/import.yml` as
     the name, paste the contents of that file from the zip, and commit.

### b. Publish with Cloudflare Pages
1. In the [Cloudflare dashboard](https://dash.cloudflare.com) open
   **Workers & Pages → Create → Pages → Connect to Git**.
2. Choose GitHub, allow access to the `raman-mittal-site` repository, select it.
3. Build settings:
   - Framework preset: **None**
   - Build command: `node scripts/build.mjs`
   - Build output directory: `dist`
4. **Save and Deploy**. The site appears at `https://<project>.pages.dev`.
5. Custom domain (optional): in the project open **Custom domains → Set up a
   domain** and follow the steps.

### c. Tell the site its address
In the repository, open `content/site.json`, click the pencil icon and set:
```
"url": "https://www.yourdomain.in",
...
"admin": { "repo": "yourname/raman-mittal-site", "branch": "main" }
```
Commit. The address is used for Google, the sitemap and link previews. The
`admin.repo` value fills in the admin sign-in form automatically.

### d. Create the admin access key
1. On GitHub: your picture (top right) → **Settings → Developer settings →
   Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name: `Website admin`. Expiration: up to a year (set a reminder to renew).
3. **Repository access → Only select repositories →** `raman-mittal-site`.
4. **Permissions → Repository permissions:**
   - **Contents: Read and write**
   - **Actions: Read and write** (for the Import buttons)
5. Generate, then copy the key (it starts with `github_pat_`). Keep it like a
   password; anyone with it can edit the website.

### e. Bring in the poems from the old site (one click)
1. Open `https://www.yourdomain.in/admin/` and sign in with the repository
   name and the access key.
2. Go to the **Import** tab and press **Import poems now**. In about two
   minutes every poem's text is copied from the old Google Site into this
   website, and each poem has its own full page (nothing links back to the old
   site). Until a poem has its text, its page is hidden from Google and left
   out of the sitemap, so empty pages never hurt the ranking.
3. Press **Find book covers now** to fetch the covers by ISBN and Amazon
   link. Any cover it can't find can be uploaded on the **Books** tab.
4. Read through a few poems to check the line breaks; fix anything in the
   **Poems** tab.

### f. Tell Google
- Add the site to [Google Search Console](https://search.google.com/search-console)
  and submit `https://www.yourdomain.in/sitemap.xml`.
- Google Sites cannot redirect, so replace each old page's content with a link
  to the new site. Unpublish the old site once the new pages show in Google.

---

## 2. Using the admin page (for Professor Mittal)

Open **`/admin/`** on the website (there's also a small "Site admin" link in
the footer). Sign in once; tick "Remember me" on your own computer.

| Tab | What you can do |
|---|---|
| **Poems** | Add a poem: title, theme, the poem itself, an optional picture and note. You can type, paste, or **load the text from a Word (.docx) or text file**. Edit or delete any poem. A new theme can be created from the theme list. |
| **Books** | Add or edit a book: title, credit line, year, publisher, ISBN, Amazon and Google Books links, and **upload the cover**. Change the order with Move up / Move down. |
| **Articles** | Add or edit an article: authors, journal, volume, pages, DOI, links, keywords, abstract or summary, and **upload the PDF**. "Write it for me" fills in the citation. |
| **Profile** | Change the home-page introduction, the About text, research interests, academic visits, emails, and the cover photo. |
| **Import** | Copy poems from the old site, and find book covers. |

Typing a poem: press Enter for a new line, and leave an empty line between
stanzas. **Preview** shows how it will look.

After **Save**, the website shows the change in about a minute. New poems
carry a "New" label and appear under "Recently added" for 60 days.

---

## 3. Quick preview without GitHub
To see the design before setup, upload `raman-mittal-cloudflare-upload.zip`
in Cloudflare (**Workers & Pages → Create → Pages → Upload assets**). That
copy can't be edited from the admin page, because only the GitHub-connected
version rebuilds itself.

---

## 4. For developers

```
content/            site.json, themes.json, poems.json, books.json, articles.json
admin/              the admin page (static; talks to the GitHub API)
assets/             css, js, self-hosted fonts (SIL Open Font Licence), images, uploads
scripts/build.mjs   builds dist/ (no dependencies)
scripts/import-google-sites.mjs   poem + cover import (run by .github/workflows/import.yml)
scripts/ornament.mjs              guilloche rosette, theme medallions, favicon
```

- `node scripts/build.mjs` builds the site; `--preview` adds a noindex header.
- `node scripts/serve.mjs` serves `dist/` at http://localhost:8080.
- Pages: `/`, `/poetry/`, `/poetry/<theme>/`, `/poetry/<theme>/<poem>/`,
  `/research/books/`, `/research/books/the-rhythm-of-law/`,
  `/research/articles/`, `/research/articles/<slug>/`, `sitemap.xml`,
  `robots.txt`, `poetry/feed.xml`. Old Google Sites paths redirect via `_redirects`.
- Design: navy and the periwinkle blue of Professor Mittal's shirt. Cormorant
  Garamond (headings), Newsreader (text and poems), Hanken Grotesk (interface).
  Each poetry theme gets its own guilloche medallion, generated at build time.
