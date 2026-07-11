---
name: Settings
width: 500
height: 640
---

## View Mode

[[toggle(bind: theme, on: dark, off: light, label: Dark Mode)]]

## Typography

[[slider(bind: fontSize, min: 12, max: 22, step: 1, label: Font Size, suffix: px)]]

[[slider(bind: lineHeight, min: 1.0, max: 1.6, step: 0.1, label: Line Height)]]

[[slider(bind: marginSize, min: 0, max: 45, step: 1, label: Card Margins, suffix: %)]]

## Card Display

[[toggle(bind: cardShadow, on: true, off: false, label: Card Shadows)]]

[[toggle(bind: showHandles, on: true, off: false, label: Show Card Handles)]]

[[toggle(bind: showConnections, on: true, off: false, label: Show Connections)]]

[[toggle(bind: connectionsAbove, on: true, off: false, label: ↳ Connections Above Cards)]]

---

[[style(text-align: center)]]
{
[[button(action: clearPage, label: Clear Page)]] [[button(action: resetSettings, label: Reset to Defaults)]]
}
