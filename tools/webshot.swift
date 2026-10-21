// Offscreen WebKit screenshots of a page served from a directory.
//
//   webshot --root DIR --path "/?page=x" --out shot.png [--width 1280] [--height 900]
//           [--ready JS] [--settle 0.6] [--eval JS] [--retina] [--writable]
//
// The directory is served over app://local/, so root-relative URLs, fetch()
// and ES modules behave as they do on a server. Console output and script
// errors are echoed with a "[page]" prefix.

import Cocoa
import WebKit

struct Options {
    var root = "."
    var path = "/"
    var out = "shot.png"
    var width = 1280.0
    var height = 900.0
    var ready = "!!document.querySelector('.doc .ln')"
    var settle = 0.6
    var eval: String? = nil
    var eval2: String? = nil
    var delay2 = 1.5
    var steps: [(Double, String)] = []
    var retina = false
    var timeout = 40.0
    var writable = false
}

func parseOptions() -> Options {
    var o = Options()
    var it = CommandLine.arguments.dropFirst().makeIterator()
    while let a = it.next() {
        switch a {
        case "--root": o.root = it.next() ?? o.root
        case "--path": o.path = it.next() ?? o.path
        case "--out": o.out = it.next() ?? o.out
        case "--width": o.width = Double(it.next() ?? "") ?? o.width
        case "--height": o.height = Double(it.next() ?? "") ?? o.height
        case "--ready": o.ready = it.next() ?? o.ready
        case "--settle": o.settle = Double(it.next() ?? "") ?? o.settle
        case "--eval": o.eval = it.next()
        case "--eval2": o.eval2 = it.next()
        case "--step":
            if let raw = it.next(), let r = raw.range(of: "::") {
                o.steps.append((Double(raw[raw.startIndex..<r.lowerBound]) ?? 0.5, String(raw[r.upperBound...])))
            }
        case "--delay2": o.delay2 = Double(it.next() ?? "") ?? o.delay2
        case "--timeout": o.timeout = Double(it.next() ?? "") ?? o.timeout
        case "--retina": o.retina = true
        case "--writable": o.writable = true
        default: break
        }
    }
    return o
}

let options = parseOptions()
let rootURL = URL(fileURLWithPath: options.root).standardizedFileURL

let mimeTypes: [String: String] = [
    "html": "text/html", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css",
    "json": "application/json", "md": "text/markdown", "otf": "font/otf", "ttf": "font/ttf",
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "svg": "image/svg+xml",
    "gif": "image/gif", "webp": "image/webp", "woff2": "font/woff2",
]

final class FileSchemeHandler: NSObject, WKURLSchemeHandler {
    func reply(_ task: WKURLSchemeTask, _ url: URL, status: Int, body: Data = Data(), type: String = "text/plain") {
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": type, "Content-Length": String(body.count)])!
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else { return }
        var path = url.path.removingPercentEncoding ?? url.path
        // --writable: behave like the dev server (saves cards, reports /api/dev)
        if options.writable {
            if path == "/api/dev" { return reply(urlSchemeTask, url, status: 200, body: Data("{\"save\":true}".utf8), type: "application/json") }
            if urlSchemeTask.request.httpMethod == "PUT", path.hasPrefix("/cards/"), path.hasSuffix(".md") {
                var body = urlSchemeTask.request.httpBody ?? Data()
                if body.isEmpty, let stream = urlSchemeTask.request.httpBodyStream {
                    stream.open()
                    var buffer = [UInt8](repeating: 0, count: 65536)
                    while stream.hasBytesAvailable {
                        let n = stream.read(&buffer, maxLength: buffer.count)
                        if n <= 0 { break }
                        body.append(buffer, count: n)
                    }
                    stream.close()
                }
                let target = rootURL.appendingPathComponent(String(path.dropFirst()))
                let temp = target.appendingPathExtension("tmp")
                try? body.write(to: temp)
                _ = try? FileManager.default.replaceItemAt(target, withItemAt: temp)
                return reply(urlSchemeTask, url, status: 204)
            }
        }
        if path.hasSuffix("/") { path += "index.html" }
        let fileURL = rootURL.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard fileURL.path.hasPrefix(rootURL.path), let data = try? Data(contentsOf: fileURL) else {
            let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: nil, headerFields: ["Content-Type": "text/plain"])!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(Data("not found".utf8))
            urlSchemeTask.didFinish()
            return
        }
        let type = mimeTypes[fileURL.pathExtension.lowercased()] ?? "application/octet-stream"
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: [
            "Content-Type": type, "Content-Length": String(data.count), "Access-Control-Allow-Origin": "*",
        ])!
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

final class LogHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        print("[page] \(message.body)")
    }
}

let consoleHook = """
(function () {
  const send = (kind, args) => window.webkit.messageHandlers.log.postMessage(kind + ': ' + args.map(a => {
    try { return typeof a === 'string' ? a : (a && a.stack) ? a.stack : JSON.stringify(a); } catch (e) { return String(a); }
  }).join(' '));
  for (const k of ['log', 'warn', 'error']) {
    const original = console[k].bind(console);
    console[k] = (...args) => { send(k, args); original(...args); };
  }
  window.addEventListener('error', e => send('uncaught', [e.message + ' @ ' + e.filename + ':' + e.lineno]));
  window.addEventListener('unhandledrejection', e => send('unhandled', [e.reason && e.reason.stack ? e.reason.stack : String(e.reason)]));
})();
"""

final class Controller: NSObject, WKNavigationDelegate {
    let web: WKWebView
    var started = Date()

    init(web: WKWebView) { self.web = web }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { poll() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail("navigation failed: \(error)") }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail("load failed: \(error)") }

    func fail(_ message: String) { print("error: \(message)"); exit(1) }

    func poll() {
        web.evaluateJavaScript(options.ready) { result, _ in
            let ready = (result as? Bool) ?? ((result as? NSNumber)?.boolValue ?? false)
            if ready {
                DispatchQueue.main.asyncAfter(deadline: .now() + options.settle) { self.finish() }
            } else if Date().timeIntervalSince(self.started) > options.timeout - 5 {
                print("warning: ready condition never became true; capturing anyway")
                self.finish()
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.poll() }
            }
        }
    }

    func finish() {
        func snapshot() {
            let cfg = WKSnapshotConfiguration()
            if !options.retina { cfg.snapshotWidth = NSNumber(value: options.width) }
            web.takeSnapshot(with: cfg) { image, error in
                guard let image = image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                      let png = rep.representation(using: .png, properties: [:]) else {
                    print("error: snapshot failed: \(String(describing: error))"); exit(1)
                }
                try? png.write(to: URL(fileURLWithPath: options.out))
                print("wrote \(options.out) (\(Int(image.size.width))x\(Int(image.size.height)))")
                exit(0)
            }
        }
        func runSteps(_ index: Int) {
            if index >= options.steps.count { DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { snapshot() }; return }
            let (delay, js) = options.steps[index]
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                self.web.evaluateJavaScript(js) { result, error in
                    if let error = error { print("step \(index + 1) error: \(error)") }
                    else if let result = result { print("step \(index + 1): \(result)") }
                    runSteps(index + 1)
                }
            }
        }
        func second() {
            guard let js2 = options.eval2 else { runSteps(0); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + options.delay2) {
                self.web.evaluateJavaScript(js2) { result, error in
                    if let error = error { print("eval2 error: \(error)") }
                    else if let result = result { print("eval2: \(result)") }
                    runSteps(0)
                }
            }
        }
        if let js = options.eval {
            web.evaluateJavaScript(js) { result, error in
                if let error = error { print("eval error: \(error)") }
                else if let result = result { print("eval: \(result)") }
                second()
            }
        } else {
            second()
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let config = WKWebViewConfiguration()
config.setURLSchemeHandler(FileSchemeHandler(), forURLScheme: "app")
let content = WKUserContentController()
content.add(LogHandler(), name: "log")
content.addUserScript(WKUserScript(source: consoleHook, injectionTime: .atDocumentStart, forMainFrameOnly: false))
config.userContentController = content

let frame = NSRect(x: 0, y: 0, width: options.width, height: options.height)
let web = WKWebView(frame: frame, configuration: config)
// Nearly transparent and non-interactive, but on screen so the page counts as visible
// (requestAnimationFrame does not run in hidden pages).
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: options.width, height: options.height),
                      styleMask: [.borderless], backing: .buffered, defer: false)
window.contentView = web
window.isOpaque = false
window.alphaValue = 0.01
window.ignoresMouseEvents = true
window.hasShadow = false
window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
window.orderFrontRegardless()

let controller = Controller(web: web)
web.navigationDelegate = controller

let target = URL(string: "app://local" + options.path)!
web.load(URLRequest(url: target))

DispatchQueue.main.asyncAfter(deadline: .now() + options.timeout) { print("error: timed out"); exit(3) }
app.run()
