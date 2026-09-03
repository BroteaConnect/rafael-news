# brotea-news fonts

Both are redistributed under the **SIL Open Font License 1.1**, which allows
embedding them and serving them from our own domain (which is exactly what the
app does: `public/fonts/`, no CDN).

| File | Family | Author | Subset |
|---|---|---|---|
| `Newsreader-600-latin.woff2` | Newsreader | Production Type | latin, weight 600 · 23 KB |
| `Inter-var-latin.woff2` | Inter | Rasmus Andersson | latin, variable 400–700 · 47 KB |

Origin: the `.woff2` files Google Fonts (`fonts.gstatic.com`) serves for each
family's `/* latin */` block. The `unicode-range` in `../fonts.css` is
literally the one that subset declares: a character outside it falls back
instead of triggering a download.

**Newsreader ships in a single weight, not variable, on purpose**: the variable
one with an optical axis weighs 129 KB against 23 KB for the single weight, and
we do not interpolate in headlines. Inter does ship variable because two single
weights add up to 94 KB and the variable one is 47 KB. Total: 70 KB in two
files.

If more trimming is ever needed, the next step is subsetting by used glyphs
(`pyftsubset`), not changing family.
