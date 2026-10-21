#!/bin/sh
# Builds tools/webshot.swift on first use, then runs it. Usage: tools/webshot.sh [webshot options]
set -e
here="$(cd "$(dirname "$0")" && pwd)"
bin="${WEBSHOT_BIN:-/tmp/claude-501/webshot/webshot}"
if [ ! -x "$bin" ] || [ "$here/webshot.swift" -nt "$bin" ]; then
    mkdir -p "$(dirname "$bin")"
    env -u TOOLCHAINS /usr/bin/xcrun swiftc -O -o "$bin" "$here/webshot.swift" 2>&1 | grep -v "sandbox-exec" || true
fi
# WebKit renders on the GPU: declare it (shared, since this is not a measurement).
exec gpu-lock run --shared -- "$bin" "$@"
