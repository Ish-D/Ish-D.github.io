---
title: Math & Visualizations
width: 600
height: 2800
---

# Math & Visualizations

[[margin(left, type: relative)]]
{
[[viz(type: polynomial, a3: 0.1, a2: 0, a1: 1, a0: 0)]]
}

This card demonstrates the flexible visualization system with various sizing and positioning options. The 2D polynomial in the left margin updates as you scroll.

---

## Inline Visualizations

You can place small visualizations [[viz(type: surface, fn: "sin(x)*cos(y)", size: tiny, display: inline)]] directly inline with your text, just like an image or icon.

Here's another example with a node graph [[viz(type: nodegraph3d, nodes: "A,B,C", edges: "A-B,B-C,C-A", size: tiny, display: inline)]] embedded in a sentence.

---

## Float Layouts

[[viz(type: polynomial3d, a: 0.3, b: 0.3, c: 0, d: 0, width: 200, height: 280, display: float-right)]]

When you float a visualization, text wraps around it naturally. This 3D polynomial surface is floated to the right, and this paragraph flows around it.

The quadratic formula $x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}$ can appear alongside the visualization. You can include any content here - math, links like [[Writing]], or regular prose.

This creates a magazine-style layout where visuals and text complement each other.

---

## Side-by-Side Comparison

[[viz(type: surface, fn: "sin(x)*cos(y)", size: small, display: float-left)]]

[[viz(type: surface, fn: "cos(x)*sin(y)", size: small, display: float-left)]]

Compare two surfaces side by side. The left shows $\sin(x)\cos(y)$ and the right shows $\cos(x)\sin(y)$. Notice how the peaks and valleys are phase-shifted by $\frac{\pi}{2}$.

---

## Right Margin Visualization

[[margin(right, type: relative)]]
{
[[viz(type: curve3d, x: "cos(t)", y: "sin(t)", z: "t/10", trange: 0:20)]]

*A helix curve*
}

The Euler identity $e^{i\theta} = \cos\theta + i\sin\theta$ connects exponentials to circular motion. The helix in the right margin shows this relationship extended into 3D.

When $\theta$ increases linearly with time, we trace a circle in the complex plane. Adding a third dimension for time itself creates the helical path shown.

---

## Centered Medium

[[viz(type: nodegraph3d, nodes: "Hub,A,B,C,D,E", edges: "Hub-A,Hub-B,Hub-C,Hub-D,Hub-E,A-B,C-D", size: medium, align: center)]]

A centered node graph at medium size, showing a hub-and-spoke topology.

---

## Full Width with Custom Height

[[viz(type: polynomial, a3: 0.05, a2: -0.5, a1: 0, a0: 2, height: 200)]]

A cubic polynomial $f(x) = 0.05x^3 - 0.5x^2 + 2$ at full width but reduced height.

---

## Math in Margins

[[margin(left, type: absolute, pos: 50)]]
{
**Formulas**

$E = mc^2$

$F = ma$

$\nabla \cdot \mathbf{E} = \frac{\rho}{\epsilon_0}$
}

Physics equations often appear in the margins of textbooks as quick references. The margin can hold both mathematical notation and small visualizations.

Matrix operations are fundamental:

$$\begin{pmatrix} a & b \\ c & d \end{pmatrix} \begin{pmatrix} x \\ y \end{pmatrix} = \begin{pmatrix} ax + by \\ cx + dy \end{pmatrix}$$

---

## Complex Layout

[[viz(type: surface, fn: "sin(sqrt(x*x+y*y))", width: 180, height: 150, display: float-right)]]

[[margin(right, type: relative)]]
{
$r = \sqrt{x^2 + y^2}$

$z = \sin(r)$
}

The ripple pattern $z = \sin(\sqrt{x^2 + y^2})$ creates concentric waves emanating from the origin. This is a radially symmetric function.

The integral $\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}$ is the famous Gaussian integral, fundamental to probability theory.

---

## Explicit Sizing

[[viz(type: curve3d, x: "cos(t)*2", y: "sin(t)*2", z: "cos(3*t)", trange: 0:12, width: 250, height: 200, align: left)]]

[[viz(type: curve3d, x: "cos(2*t)", y: "sin(3*t)", z: "sin(t)", trange: 0:12, width: 250, height: 200, align: right)]]

Two Lissajous-like curves with explicit 250×200 sizing, aligned left and right respectively.

---

## Interactive 3D Polynomial

[[viz(type: polynomial3d, a: 0.5, b: 0.5, c: 0, d: 0, align: center)]]

The surface $z = ax^2 + by^2 + cxy + d$ - adjust the sliders to explore saddle points, paraboloids, and other quadric surfaces.

---

## Code vs Math

Code blocks are protected: `$x = y + 1$`

```
$\LaTeX$ in code blocks is not rendered
```

But inline math works: $\lim_{x \to 0} \frac{\sin x}{x} = 1$