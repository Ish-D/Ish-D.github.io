# ish

My site: pages are markdown cards in `cards/`, laid out and drawn by the engine in `core/` (see `core/README.md`). No dependencies and no build step to work on it.

```
npm run serve     # dev server on :8123 (any address that is not a file is the app)
npm test          # unit tests
npm run smoke     # a few pages in offscreen WebKit (macOS)
npm run build     # the site as it is published, into _site (a page per card, feed, sitemap)
```

Every push runs the tests and loads the built site in Chromium, Firefox and WebKit (`.github/workflows/site.yml`). On `master` the build is published to GitHub Pages. The old site is on the `legacy` branch.
