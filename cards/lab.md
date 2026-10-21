---
name: Lab
date: 10-20-2026
---

# Lab

[[summary]]{A scratch page for the layout engine: columns, shaped wrap, live numbers, and notes that move out of each other's way.}

---

## Live numbers

[[drop(A)]]ttention divides its scores by a constant before the softmax, and the reason is easiest to see by turning a knob. Each query and key has [[var(dk, 64, min: 4, max: 1024, step: 4)]] dimensions here; drag that number, or focus it and use the arrow keys, and watch both rows change.[[note(right)]]{}{The number in the sentence, the equation below and the figure all read one article variable. Nothing is wired up by hand in the figure's markup.}

[[viz(type: softmax-scale, var: dk, tokens: 8, height: 300, width: 100%)]]

The top row is the plain softmax of the raw dot products. Their variance grows with $d_k = \val{dk}$, so the largest score runs away from the rest and the softmax collapses onto one token. The bottom row divides by $\sqrt{d_k}$ first, which keeps the scores at unit variance whatever the dimension, so the distribution stays spread out:

$$\mathrm{softmax}\!\left(\frac{QK^{\top}}{\sqrt{\val{dk}}}\right)V$$

## Two columns and a shape

A paragraph across the full measure comes first so the difference is visible. Knuth and Plass justify a paragraph as a whole, trading a little tightness in one line for a little looseness in another, which is why the right edge looks calm even in a narrow measure.

[[columns(2, gap: 44)]]
{
[[image(images/photography/koi.jpg, place: gutter, width: 220, height: 220, wrap: circle, pad: 14, fit: cover)]]{Koi, on the seam; both columns curve around the circle}
Large language models have very quickly transitioned from niche research to a part of every day life. When I started at my current job in August, the company had just begun giving people Claude Code budgets and setting up internal tooling. Within a few months, everyone was running any non-trivial task through Claude before anything else. The more I talk to friends and family across various industries the more everyone reflects on pre-AI work as some sort of archaic period.

These tools span every domain now: there is diffusion-powered image generation in Photoshop, a slew of coding assistants, and increasingly popular full blown personal assistants that run on your own machine and can read your files, answer your mail and book your travel. The bet behind all of it is that by training sufficiently large networks to learn the underlying distribution of language we are really training a general model of the world.
}

[[image(images/photography/pacifica.png, place: right, width: 200, height: 200, wrap: ellipse, pad: 14, fit: cover)]]{Pacifica}
After the columns the page returns to one measure. This picture floats to the right and the text beside it follows the ellipse, line by line, with the line breaker choosing breaks for the width each line actually has.[[note(left)]]{}{Notes can sit on either side. When several land close together the solver moves them as little as it can and keeps them in order.} Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.[[note(right)]]{}{A second note a few lines below the first, so you can see two notes share a margin.}

## A drawing

[[drawing(drawings/kv-cache.svg, place: block, width: 360, caption: "The cache keeps every past key and value; a new token only adds a row.")]]

The drawing above is an SVG file inlined into the page, so its strokes take the text color and its fills take the page color in both themes.

## Margin ergonomics

A note can lie on its side [[note(left, orient: vertical)]]{}{Set sideways, reading bottom to top on the left and top to bottom on the right.} and one can be pinned to a fixed place on the page.[[note(right, type: absolute, pos: 120)]]{}{Pinned 120px from the top of the page, whatever the text does.}

A long remark can be capped with a height and opened on demand.[[note(left, maxh: 80px)]]{}{This note is much longer than its cap. It keeps going for a good many lines so that the cap has something to cut off, and a small control at the corner opens it to the full text and closes it again. Hovering the note or its number lights up the other one.}
