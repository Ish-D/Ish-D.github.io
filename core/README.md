# Site core

A layout engine and editor for long-form pages. No dependencies, no build step. `node --test "test/**/*.test.js"` runs the tests.

| Folder | What it does |
| --- | --- |
| `doc/` | Parser with source ranges, `setArg` style edits, front matter |
| `text/` | Knuth-Plass line breaking, hyphenation, measuring |
| `layout/` | Columns, slots around shapes, objects, margin notes, page layout; `contour.js` turns lines of text into the shape they fill; `print.js` and `paginate.js` set a page for paper |
| `render/` | Layout to DOM, strokes, stylesheet |
| `edit/` | In-place editor, undo, insert menu, figure tools, sketch pad |
| `runtime/` | Article variables, scrubbing, figures |
| `figures/` | Figures that read article variables |
| `vault/` | Encrypted private pages and drafts kept in the GitHub repo |
| `app/` | The shell: `main.js`, contents rail, backstage, printing |

## Writing

Plain markdown plus directives: `[[name(args)]]{group}`.

- `[[image(src, place: left|right|center|gutter|block|span|full|margin-left|margin-right, wrap: circle|ellipse|box|polygon(...), width:, height:, pad:, fit:)]]{caption}`; a figure placed in a margin stands there, level with the block after it, and where the page has no margin (a phone) it stands in the column on that side
- `[[columns(2, gap: 40)]]{ ... }`
- `[[note(left|right, orient: vertical, type: absolute, pos: 120, maxh: 80px)]]{marker}{body}`
- `[[var(name, value, min:, max:, step:)]]`, `\val{name}` in math, `[[viz(type: softmax-scale, var: name)]]`
- `[[drawing(file.svg)]]` or `[[drawing(view: 600x300)]]{strokes}` (click it in edit mode to draw)
- `[[gallery(columns: 3)]]{path | caption}`
- `[[viz(type: umbrella, place: gutter, width: 200, height: 270, wrap: box)]]` an old man in the rain, smoking a pipe under his umbrella, who watches the pointer (`figures/umbrella.js`). Animated figures run on `runtime/loop.js`, which steps them only while they are on screen, the tab is showing and the reader has not asked for less motion.

## Editing

Pencil in the top right turns editing on. Click a block to edit its source, click away to see it rendered. A `+` under a block inserts new things. Click a figure to select it: it stays as it looks on the page, with a frame, a grip to drag it, a corner handle to resize it and an inspector panel for everything else (place, wrap, space around, size, nudge, layer, caption, file). Changes apply live. `Source` in the panel turns it into text if you want that. Click a margin note to edit it where it stands; drag the grip above it to move it (it pins itself with `type: absolute, pos:` and changes side when dropped on the other half of the page). The test page `layout-test` has a two-column spread, a drawing in the seam with circular wrap, and two notes to try this on.

## Backstage

Hidden. Type `backstage`, open `/#backstage`, or hold the gear for a second and a half. First time, it asks for a GitHub token (fine-grained, Contents read and write on this repo only), the repo, and a password. After that it asks for the password.

- `vault.json` (public) holds a random master key wrapped by a key from your password (scrypt) and the token, sealed.
- Private pages and drafts are sealed with the master key on the `private` branch. They save as you type, queue when offline, and merge if two devices edit.
- A page with a public name can be published (the arrow button); that commits plain source to `cards/<name>.md` and your manifest action does the rest.

The vault file is public, so the password is the only protection. Use a long passphrase.

## Text is as big as its lines

A paragraph beside a figure is a stepped shape, not a rectangle. `layout/contour.js` turns a block's lines into that shape, and three things use it: the outline shown when you point at text while editing, the area that counts as a click on the text (it is the lines themselves), and the box drawn around text being edited. The editing box wraps its lines around whatever the page wraps around, because the layout gives the editor slot the blocked stretch of each line band (`placeEditor` in `layout/flow.js`).

## Type

- **Width:** the text column is a fixed 32em, centred, whatever the window. Readers pick 24 to 44em in the settings panel, or by dragging the edge of the column. It gives way only to keep the margins wide enough for notes; below that the page has no margins and notes are set inline.
- **One weight:** the font has a Regular and nothing else, so nothing is faked bold. Titles are large roman, section heads are small tracked capitals (`caps` and `tracking` on a font spec), strong text is capitals, and emphasis is the only slanted type. The title is a multiple of the body size that grows with the window (`TITLE` in `layout/style.js`).
- **Spaces:** the layout sets every space as plain glue. The font kerns against spaces (after `, . : ;`, before `A T V W Y`), so spaces are drawn from their own `@font-face` in `render/doc.css` and the browser cannot do it. A page in WebKit matches its layout to a fraction of a pixel.
- **Punctuation:** `text/punctuation.js` sets curly quotes, ellipses and dashes when a paragraph is laid out. The source keeps what was typed, and code is left alone.
- **Rhythm:** no indents; paragraphs are one blank line apart. Every block starts and ends on a line of the body grid (`snapToGrid` in `layout/flow.js`), so lines in different columns and beside figures sit on the same rows. Text in another size has its own spacing. `[[break]]` adds nothing and `[[bigbreak]]` adds one line.
- **Hanging punctuation:** opening quotes and brackets hang past the left edge of a column, and closing quotes, brackets, commas, full stops, colons and hyphens past the right edge, so the letters line up with the margin (`text/protrusion.js`; the line breaker counts what hangs as extra width). Text beside a figure or a drop cap keeps its edge, and code and addresses are not hung.
- **Narrow columns:** a column under 30em is set ragged, because justified spaces turn gappy there (`layout/paragraph.js`). In a wider column, a slot under 22em beside a figure is ragged too.
- **Line breaks:** no more than two hyphens in a row, the last word of a paragraph is never split, and an address breaks after a slash or a hyphen it already has.
- **Lint:** `npm run lint-type` sets every page at phone to desktop widths and lists the lines set badly: spaces too wide or too tight, a last line of one word, hyphens stacked down the edge, and lines that stick out of their column. `node tools/lint-type.js <page> --verbose` shows each line.
- **Copy and find:** every line is its own box, so each line also carries what follows it as text that is not drawn (`.sp`): a space between words, a newline at the end of a paragraph, nothing inside a word. A word split by a hyphen is whole in the text of its first line, with the rest at no size (`.tl`); the hyphen and the piece on the next line are generated content, so they are never found or copied twice. Copying reads the text straight off the selection (`selectionText`) and leaves out the section link and math drawn twice, so a paragraph pastes as it was written. In WebKit a phrase that wraps at a space is found; Chrome and Firefox are not checked.

## The top line

The line across the top of a page (`app/chrome.js`) is as wide as the text and goes with the page when it scrolls. On the left is the name of the site, which takes you home (the home page leaves it out, its title says it). On the right, `Aa` opens the text size, the width and dark mode, and `/` opens the list of pages (the `/` key does too): type to narrow it, arrows and Enter to go, Escape to close (`app/index-panel.js`). The owner has Edit, Publish and Backstage there as well. Pages under `unlisted` in `site.json` are not in that list, in Writing or in Tags (the manifest marks them), unless you are editing; they still open at their address.

## Print

The page on screen is a pile of lines placed by coordinates, which a printer cannot cut into sheets. So when someone prints, `app/print.js` sets the page again for paper (`layout/print.js`), cuts it into sheets (`layout/paginate.js`) and draws them off screen (`render/print.js`). The print stylesheet shows only those.

- **Sheet:** one column of 15px type, black on white whatever the theme. Floats become their own block and the contents box is left out. Nothing placed or nudged by hand on screen moves anything on paper.
- **Margins:** margin notes stay in the margins. A page with notes gives up some of its width (the column is at most 32em, and about 29em on Letter) to keep a strip of 140px on each side. A page with none uses the whole 32em. Each note goes on the sheet of the line it belongs to and is placed there, by the same solver as on screen, between the top and bottom of that sheet. A note too tall for a strip, or that cannot sit near its line, is set small under its paragraph, and the page is set again with it there.
- **Paper:** Letter when the browser's language is US, Canada, Mexico or a few others, A4 everywhere else. `@page` is set to match with no margin; the sheets make their own.
- **Cuts:** a sheet never starts or ends on one line of a paragraph, a heading stays with the lines after it, the lines beside a drop cap stay together, and figures, display math and table rows move whole. Code splits between lines. A divider at the edge of a sheet is dropped, and a figure taller than a sheet is shrunk to fit.
- **Furniture:** the title runs along the top from the second sheet on. The address and the sheet number run along the bottom.
- **Figures:** a figure is not run again on paper, it is a picture (`runtime/snapshot.js`). A figure the page draws itself (`defineFigure`) is drawn once more for the sheet, in the colors of paper. A drawing in it (svg) is painted onto a canvas, a canvas is copied, and the browser prints a canvas as it was drawn. A figure a page script builds (the 3D ones) is copied as it is on screen, after it is told to draw once more with a `printsnapshot` event, so a WebGL canvas can be read. In the dark theme those come out dark. Controls in a figure are left out, and a figure that cannot be pictured says where to see it. A figure that is only there to look at on screen keeps off paper with `defineFigure(name, factory, { paper: false })`, and the page is laid out without it.
- **When:** `beforeprint` builds the sheets (so does the print media query, in a browser that says nothing before printing; sheets made a moment ago are kept) and `afterprint` clears them. They are not shown on screen (`display: none`).
- `node tools/print-preview.js cards/<page>.md out-dir` draws the sheets as PNGs without a browser (`--paper a4`, `--sheets 1,3`). `tools/webshot.sh ... --pdf out.pdf` prints through WebKit's print path, and `npm run smoke` does that for two pages and checks that every sheet comes out and the end of the page is on paper. Chrome and Firefox are not checked here.

## Publishing

The site that is served is what `tools/build-site.js` makes (`npm run build`, into `_site`): the files the browser needs, `cards/manifest.json` from the cards, a page for each card at its path (`/lab/`) with its title and preview in the head and its text for those who cannot run the page, `feed.xml`, `sitemap.xml` and `robots.txt`. Address, description and the pages kept out of the lists are in `site.json`. A page's address is its path; `?page=` and the older forms still open it, and an address with no page of its own goes through `404.html` to the app. `npm run serve` serves the folder as the dev server does, and `-- --pages` answers as GitHub Pages does.

`.github/workflows/site.yml` runs on every push: the tests, then `tools/browser-check.mjs` in Chromium, Firefox and WebKit (Playwright) against the built site. It checks that pages open at their paths without script errors, that links and missing addresses land on the app, that lines are drawn where they were laid out, that find works, and that a page prints: Chromium makes the PDF and checks that every sheet is a page, the end of the page is on paper and the figures are there. Chromium decides whether the site is published; Firefox and WebKit are reported. On master the build is published, which needs Settings > Pages > Source set to GitHub Actions; until it is, Pages publishes the files on the branch as before and the deploy step says so. On other branches the pictures and PDFs each browser made are put on the `ci-artifacts` branch.

## Editing aids

- **Snapping:** things moved by hand (figures, margin notes, a figure's width) are eased toward the lines worth lining up with: the text column's edges and centre, the seam between columns, margins, other figures, the tops of paragraphs. The pull is soft: it only reaches a few pixels, the thing never jumps, it rests on the line for a moment and carries on, so text beside it flows the same with or without snapping. Hold Alt to move freely. If a figure is resting on the column's edge or centre or the seam when you let go, it is saved as a placement (`place: left`, `center`, `gutter`). Inside columns `center` and `right` mean the column's own, so the middle of a pair is the seam and saves as `gutter`. Otherwise it is saved as a share of the column (`dx: 4%`) and lines of type (`dy: 1.5em`). A moved margin note is saved as a nudge from its anchor (`dy: 3em`). Either way the page keeps its shape at other screen sizes.
- **Small screens:** nothing is previewed, because pages are expected to fit on their own. Columns give way (`columns(2, min: 12em)`), a float that would leave under 12em of text beside it moves onto its own line, and margin notes become inline text when there is no room for margins. `test/layout/responsive.test.js` lays every page out at phone to desktop widths and checks nothing spills or overlaps.
- **Keys:** with a figure selected, arrows nudge it (Shift for bigger steps), Delete removes it, Cmd-D duplicates it.
- `npm run smoke` loads a few pages in offscreen WebKit and fails on script errors.
