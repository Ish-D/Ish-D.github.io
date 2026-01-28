---
name: Settings
width: 500
height: 640
---

## View Mode

[[toggle(bind: theme, on: dark, off: light, label: Dark Mode)]]

[[toggle(bind: readerMode, on: true, off: false, label: Reader Mode)]]

## Typography

[[slider(bind: fontSize, min: 10, max: 18, step: 1, label: Font Size, suffix: px)]]

[[slider(bind: lineHeight, min: 1.2, max: 2.0, step: 0.1, label: Line Height)]]

[[slider(bind: marginSize, min: 0, max: 25, step: 1, label: Card Margins, suffix: %)]]

## Card Display

[[toggle(bind: cardShadow, on: true, off: false, label: Card Shadows)]]

[[toggle(bind: showHandles, on: true, off: false, label: Show Card Handles)]]

[[toggle(bind: showConnections, on: true, off: false, label: Show Connections)]]

[[toggle(bind: connectionsAbove, on: true, off: false, label: ↳ Connections Above Cards)]]

[[toggle(bind: showPreviews, on: true, off: false, label: Card Link Previews)]]

---

[[style(text-align: center)]]
{
[[button(action: clearPage, label: Clear Page)]] [[button(action: resetSettings, label: Reset to Defaults)]]
}
