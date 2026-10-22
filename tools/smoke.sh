#!/bin/sh
# Loads a few pages in offscreen WebKit, with editing on, and fails on any script error,
# when the app is missing a part, or when a page is not drawn the way it was laid out.
# Tests cannot see these: most of the app only runs in a browser.
set -u
here="$(cd "$(dirname "$0")/.." && pwd)"
status=0
check='(()=>{const a=window.__v2&&window.__v2.app;const need=["selection","snapper","hover","hoverOutline","inserter","toolbar","prefs","view","pages","saver"];const missing=need.filter(k=>!a||!a[k]);document.body.classList.add("editing");console.log("SMOKE "+(missing.length?"missing:"+missing.join(","):"ok")+" blocks="+(a&&a.state.layout?a.state.layout.blocks.length:0));return 1})()'
# Justified lines are drawn at their natural width and compared with the width the layout gave them.
fidelity='(()=>{const lines=[...document.querySelectorAll(".ln.just")];for(const l of lines){l.style.textAlign="left";l.style.textAlignLast="left"}let bad=0;for(const l of lines){const k=[...l.children].filter(c=>!c.classList.contains("mk")&&!c.classList.contains("sp")).pop();if(k&&Math.abs(k.getBoundingClientRect().right-l.getBoundingClientRect().left-parseFloat(l.style.width))>0.5)bad++}console.log("FIDELITY lines="+lines.length+" bad="+bad);return 1})()'
# A word split by a hyphen, and a phrase that wraps at a space, are looked for with the browser's own find.
find='(()=>{const ln=[...document.querySelectorAll(".ln")];let word="",phrase="";for(let i=0;i<ln.length-1&&!(word&&phrase);i++){const hd=ln[i].querySelector(".hd");const tl=hd&&hd.parentNode.querySelector(".tl");if(!word&&tl)word=hd.textContent+tl.textContent;const sp=ln[i].querySelector(".sp");if(!phrase&&sp&&sp.textContent===" "){const a=ln[i].textContent.trim().split(/\s+/).slice(-2);const b=ln[i+1].textContent.trim().split(/\s+/).slice(0,2);if(a.length===2&&b.length===2)phrase=a.concat(b).join(" ")}}const found=(t)=>{getSelection().removeAllRanges();return t?window.find(t,false,false,true):false};console.log("FIND word="+found(word)+" phrase="+found(phrase));return 1})()'
for page in menu lab layout-test llms_for_bozos_1 about umbrella; do
    out="$("$here/tools/webshot.sh" --root "$here" --path "/?page=$page&theme=light" --out "/tmp/smoke-$page.png" --width 1280 --height 800 --settle 1 --timeout 90 --step "1.2::$fidelity" --step "1.5::$check" --step "1.8::$find" 2>&1)"
    if echo "$out" | grep -Eq "uncaught|unhandled|error:|SMOKE missing"; then
        echo "FAIL $page"; echo "$out" | grep -E "uncaught|unhandled|error|SMOKE" | head -5; status=1
    elif ! echo "$out" | grep -q "SMOKE ok"; then
        echo "FAIL $page (the app did not start)"; status=1
    else
        echo "ok   $page  $(echo "$out" | grep -o 'blocks=[0-9]*')"
    fi
    # the posts are set at a width where nothing stretches past the cap, so nearly every line must match
    case "$page" in
        about|llms_for_bozos_1)
            counts="$(echo "$out" | sed -n 's/.*FIDELITY lines=\([0-9]*\) bad=\([0-9]*\).*/\1 \2/p' | tail -1)"
            set -- $counts
            if [ -z "$counts" ] || [ "$2" -gt $(( $1 / 20 )) ]; then
                echo "FAIL $page: ${2:-?} of ${1:-?} justified lines are not drawn at the width they were laid out"; status=1
            fi ;;
    esac
    # a word split across lines and a phrase that wraps have to be found, wherever the page has them
    case "$page" in
        llms_for_bozos_1)
            found="$(echo "$out" | sed -n 's/.*FIND \(word=[a-z]* phrase=[a-z]*\).*/\1/p' | tail -1)"
            if [ "$found" != "word=true phrase=true" ]; then
                echo "FAIL $page: find did not reach a split word and a wrapped phrase ($found)"; status=1
            fi ;;
    esac
done

# Printing goes through WebKit's print path, which is what the print menu uses. The sheets made for it are counted, the
# printed pages have to be as many, and the last words of the page have to be on paper (a page that is cut off loses them).
sheets='(()=>{window.__v2.app.print.prepare();const r=document.querySelector(".print-root");const last=[...document.querySelectorAll(".doc > .blk")].pop();const tail=(last?last.textContent:"").replace(/[^A-Za-z0-9]/g,"").toLowerCase().slice(-30);console.log("PRINT sheets="+r.querySelectorAll(".sheet").length+" notes="+r.querySelectorAll("aside.note").length+" figures="+r.querySelectorAll(".viz-container").length+" tail="+tail);return 1})()'
if ! command -v pdfinfo >/dev/null 2>&1 || ! command -v pdftotext >/dev/null 2>&1; then
    echo "skip printing (pdfinfo and pdftotext are needed to look at the pages)"
else
    for page in llms_for_bozos_1 umbrella; do
        pdf="/tmp/smoke-print-$page.pdf"
        rm -f "$pdf"
        out="$("$here/tools/webshot.sh" --root "$here" --path "/?page=$page&theme=light" --pdf "$pdf" --width 1280 --height 800 --settle 1 --timeout 120 --step "1.0::$sheets" 2>&1)"
        line="$(echo "$out" | sed -n 's/.*PRINT \(sheets=.*\)/\1/p' | tail -1)"
        want="$(echo "$line" | sed -n 's/.*sheets=\([0-9]*\).*/\1/p')"
        notes="$(echo "$line" | sed -n 's/.*notes=\([0-9]*\).*/\1/p')"
        ending="$(echo "$line" | sed -n 's/.*tail=\([a-z0-9]*\).*/\1/p')"
        pages="$(pdfinfo "$pdf" 2>/dev/null | sed -n 's/^Pages: *//p')"
        text="$(pdftotext "$pdf" - 2>/dev/null | tr -cd 'A-Za-z0-9' | tr 'A-Z' 'a-z')"
        if echo "$out" | grep -Eq "uncaught|unhandled|error:"; then
            echo "FAIL print $page"; echo "$out" | grep -E "uncaught|unhandled|error" | head -5; status=1
        elif [ -z "$want" ] || [ "$pages" != "$want" ]; then
            echo "FAIL print $page: ${pages:-no} pages were printed for ${want:-no} sheets"; status=1
        elif [ -n "$ending" ] && ! echo "$text" | grep -q "$ending"; then
            echo "FAIL print $page: the end of the page is not on paper ($ending)"; status=1
        else
            echo "ok   print $page  sheets=$pages notes=$notes"
        fi
        case "$page" in
            llms_for_bozos_1)
                if [ "${notes:-0}" -lt 10 ]; then echo "FAIL print $page: only ${notes:-0} notes are in the margins"; status=1; fi ;;
            umbrella)
                # the man and the rain are two pictures on the first page
                if command -v pdfimages >/dev/null 2>&1; then
                    images="$(pdfimages -list -f 1 -l 1 "$pdf" 2>/dev/null | tail -n +3 | wc -l | tr -d ' ')"
                    if [ "$images" -lt 2 ]; then echo "FAIL print $page: the figure is not on the page ($images pictures)"; status=1; fi
                fi ;;
        esac
    done
fi
exit $status
