# Site core

A layout engine and editor for long-form pages. No dependencies, no build step. `node --test "test/**/*.test.js"` runs the tests.

| Folder | What it does |
| --- | --- |
| `doc/` | Parser with source ranges, `setArg` style edits, front matter |
| `text/` | Knuth-Plass line breaking, hyphenation, measuring |
| `layout/` | Columns, slots around shapes, objects, margin notes, page layout; `contour.js` turns lines of text into the shape they fill |
| `render/` | Layout to DOM, strokes, stylesheet |
| `edit/` | In-place editor, undo, insert menu, figure tools, sketch pad |
| `runtime/` | Article variables, scrubbing, figures |
| `figures/` | Figures that read article variables |
| `vault/` | Encrypted private pages and drafts kept in the GitHub repo |
| `app/` | The shell: `main.js`, contents rail, backstage |

## Writing

Plain markdown plus directives: `[[name(args)]]{group}`.

- `[[image(src, place: left|right|center|gutter|block|span|full, wrap: circle|ellipse|box|polygon(...), width:, height:, pad:, fit:)]]{caption}`
- `[[columns(2, gap: 40)]]{ ... }`
- `[[note(left|right, orient: vertical, type: absolute, pos: 120, maxh: 80px)]]{marker}{body}`
- `[[var(name, value, min:, max:, step:)]]`, `\val{name}` in math, `[[viz(type: softmax-scale, var: name)]]`
- `[[drawing(file.svg)]]` or `[[drawing(view: 600x300)]]{strokes}` (click it in edit mode to draw)
- `[[gallery(columns: 3)]]{path | caption}`

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

## Editing aids

- **Snapping:** things moved by hand (figures, margin notes, a figure's width) are eased toward the lines worth lining up with: the text column's edges and centre, the seam between columns, margins, other figures, the tops of paragraphs. The pull is soft: it only reaches a few pixels, the thing never jumps, it rests on the line for a moment and carries on, so text beside it flows the same with or without snapping. Hold Alt to move freely. If a figure is resting on the column's edge or centre or the seam when you let go, it is saved as a placement (`place: left`, `center`, `gutter`); otherwise as a share of the column (`dx: 4%`) and lines of type (`dy: 1.5em`). A moved margin note is saved as a nudge from its anchor (`dy: 3em`). Either way the page keeps its shape at other screen sizes.
- **Small screens:** nothing is previewed, because pages are expected to fit on their own. Columns give way (`columns(2, min: 12em)`), a float that would leave under 12em of text beside it moves onto its own line, and margin notes become inline text when there is no room for margins. `test/layout/responsive.test.js` lays every page out at phone to desktop widths and checks nothing spills or overlaps.
- **Keys:** with a figure selected, arrows nudge it (Shift for bigger steps), Delete removes it, Cmd-D duplicates it.
- `npm run smoke` loads a few pages in offscreen WebKit and fails on script errors.
