---
title: LaTeX Math Test
width: 400
height: 500
---

# LaTeX Math Test

## Inline Math

Here's some inline math: $x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}$ in the middle of a sentence.

More examples:
- The famous equation: $E = mc^2$
- A simple fraction: $\frac{1}{2}$
- Greek letters: $\alpha + \beta = \gamma$

## Display Math

The quadratic formula:

$$x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}$$

Matrix example:

$$\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}$$

Integral example:

$$\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}$$

## Mixed Content

This paragraph has both **bold text** and inline math: $\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$.

Links work too: [[Writing]] and math: $\lim_{x \to 0} \frac{\sin x}{x} = 1$.

[[margin(left)]]
{
# Math in Margins

Inline in margin: $a^2 + b^2 = c^2$

Display in margin:
$$\frac{d}{dx}[x^n] = nx^{n-1}$$
}

## Code vs Math

Code should not be processed: `$x = y + 1$`

```
$x = y + 1$ should also not be processed
```

But this should be: $x = y + 1$