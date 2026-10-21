#!/bin/sh
# Loads a few pages in offscreen WebKit, with editing on, and fails on any script error
# or when the app is missing a part. Tests cannot see these: most of the app only runs in a browser.
set -u
here="$(cd "$(dirname "$0")/.." && pwd)"
status=0
check='(()=>{const a=window.__v2&&window.__v2.app;const need=["selection","snapper","hover","hoverOutline","inserter","toolbar","prefs","viewport","view","pages","saver"];const missing=need.filter(k=>!a||!a[k]);document.body.classList.add("editing");console.log("SMOKE "+(missing.length?"missing:"+missing.join(","):"ok")+" blocks="+(a&&a.state.layout?a.state.layout.blocks.length:0));return 1})()'
for page in menu lab layout-test llms_for_bozos_1 about; do
    out="$("$here/tools/webshot.sh" --root "$here" --path "/?page=$page&theme=light" --out "/tmp/smoke-$page.png" --width 1280 --height 800 --settle 1 --timeout 90 --step "1.5::$check" 2>&1)"
    if echo "$out" | grep -Eq "uncaught|unhandled|error:|SMOKE missing"; then
        echo "FAIL $page"; echo "$out" | grep -E "uncaught|unhandled|error|SMOKE" | head -5; status=1
    elif ! echo "$out" | grep -q "SMOKE ok"; then
        echo "FAIL $page (the app did not start)"; status=1
    else
        echo "ok   $page  $(echo "$out" | grep -o 'blocks=[0-9]*')"
    fi
done
exit $status
