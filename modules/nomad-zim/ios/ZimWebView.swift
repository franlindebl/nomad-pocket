import ExpoModulesCore
import UIKit
import WebKit

/// WKWebView that renders ZIM content through `zim://<uuid>/<path>`.
final class ZimWebView: ExpoView, WKNavigationDelegate, WKUIDelegate {
  let onNavigationChange = EventDispatcher()
  let onLoadEnd = EventDispatcher()

  let webView: WKWebView
  private let schemeHandler = ZimSchemeHandler()
  private var observations: [NSKeyValueObservation] = []

  var archiveId: String?
  var requestedPath: String?
  private var loadedArchiveId: String?
  private var loadedRequestedPath: String??
  private var darkMode = false
  private var textZoom = 100
  private var lastNavigationPayload: [String: AnyHashable] = [:]

  required init(appContext: AppContext? = nil) {
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(schemeHandler, forURLScheme: ZimURL.scheme)
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = .all
    config.dataDetectorTypes = []
    config.websiteDataStore = .nonPersistent()
    webView = WKWebView(frame: .zero, configuration: config)
    super.init(appContext: appContext)

    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true
    webView.isOpaque = false
    webView.backgroundColor = .clear
    webView.scrollView.backgroundColor = .clear
    webView.scrollView.contentInsetAdjustmentBehavior = .automatic
    if #available(iOS 16.4, *) {
      webView.isInspectable = true
    }
    addSubview(webView)
    installUserScripts()

    observations = [
      webView.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in self?.emitNavigation() },
      webView.observe(\.canGoForward, options: [.new]) { [weak self] _, _ in self?.emitNavigation() },
      webView.observe(\.url, options: [.new]) { [weak self] _, _ in self?.emitNavigation() },
      webView.observe(\.title, options: [.new]) { [weak self] _, _ in self?.emitNavigation() },
    ]
  }

  deinit {
    observations.forEach { $0.invalidate() }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    webView.frame = bounds
  }

  private var archive: NZArchive? {
    archiveId.flatMap { ZimRegistry.shared.archive(id: $0) }
  }

  // MARK: - Loading

  /// Called after every prop update: (re)loads when the archive or the `path` prop changed.
  func loadRequestedIfNeeded() {
    guard let archiveId else { return }
    if loadedArchiveId == archiveId, let loaded = loadedRequestedPath, loaded == requestedPath { return }
    guard archive != nil else { return }
    loadedArchiveId = archiveId
    loadedRequestedPath = .some(requestedPath)
    load(path: requestedPath ?? "")
  }

  /// Loads a ZIM path ("" = main page), resolving redirects first so relative URLs work.
  func load(path rawPath: String) {
    guard let archive else { return }
    var path = rawPath
    var fragment: String? = nil
    if let hash = path.firstIndex(of: "#") {
      fragment = String(path[path.index(after: hash)...])
      path = String(path[..<hash])
    }
    if path.hasPrefix("/") { path.removeFirst() }
    if path.isEmpty { path = archive.mainPath ?? "" }
    if let info = archive.entryInfo(atPath: path) { path = info.path }
    guard let url = ZimURL.url(uuid: archive.uuid, path: path, fragment: fragment) else { return }
    webView.load(URLRequest(url: url))
  }

  // MARK: - Appearance

  func setDarkMode(_ on: Bool) {
    guard on != darkMode else { return }
    darkMode = on
    installUserScripts()
    webView.evaluateJavaScript("window.__nomadSetDark && window.__nomadSetDark(\(on));", completionHandler: nil)
  }

  func setTextZoom(_ percent: Int) {
    let value = max(50, min(300, percent))
    guard value != textZoom else { return }
    textZoom = value
    installUserScripts()
    webView.evaluateJavaScript("window.__nomadSetZoom && window.__nomadSetZoom(\(value));", completionHandler: nil)
  }

  private func installUserScripts() {
    let controller = webView.configuration.userContentController
    controller.removeAllUserScripts()
    let source = ZimWebScripts.bootstrap(dark: darkMode, zoom: textZoom)
    controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    controller.addUserScript(WKUserScript(source: "window.__nomadApply && window.__nomadApply();", injectionTime: .atDocumentEnd, forMainFrameOnly: true))
  }

  // MARK: - Find in page

  /// Highlights all matches (JS, so we get counts like Android's FindListener) and
  /// scrolls to the next/previous one.
  func find(_ text: String, backwards: Bool, completion: @escaping ([String: Any]) -> Void) {
    guard !text.isEmpty else {
      clearFind()
      completion(["found": false])
      return
    }
    guard let data = try? JSONSerialization.data(withJSONObject: [text]), let arg = String(data: data, encoding: .utf8) else {
      completion(["found": false])
      return
    }
    let js = "JSON.stringify(window.__nomadFind ? window.__nomadFind(\(arg)[0], \(backwards)) : {found:false})"
    webView.evaluateJavaScript(js) { result, _ in
      guard let json = result as? String, let d = json.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else {
        completion(["found": false])
        return
      }
      completion(obj)
    }
  }

  func clearFind() {
    webView.evaluateJavaScript("window.__nomadClearFind && window.__nomadClearFind();", completionHandler: nil)
  }

  // MARK: - Events

  private func currentPath() -> String? {
    guard let url = webView.url, url.scheme == ZimURL.scheme else { return nil }
    return ZimURL.path(of: url)
  }

  private func emitNavigation() {
    guard let path = currentPath() else { return }
    let title = archive?.entryInfo(atPath: path)?.title ?? webView.title ?? ""
    let payload: [String: AnyHashable] = [
      "path": path,
      "title": title.isEmpty ? (webView.title ?? "") : title,
      "canGoBack": webView.canGoBack,
      "canGoForward": webView.canGoForward,
    ]
    guard payload != lastNavigationPayload else { return }
    lastNavigationPayload = payload
    onNavigationChange(payload)
  }

  // MARK: - WKNavigationDelegate

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else {
      decisionHandler(.allow)
      return
    }
    if scheme == ZimURL.scheme {
      let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
      if isMainFrame, navigationAction.navigationType != .backForward, let archive,
         url.host?.lowercased() == archive.uuid {
        let path = ZimURL.path(of: url)
        if let info = archive.entryInfo(atPath: path), info.path != path {
          // Redirect: navigate to the canonical URL so the document base is right.
          decisionHandler(.cancel)
          load(path: info.path + (url.fragment.map { "#\($0)" } ?? ""))
          return
        }
      }
      decisionHandler(.allow)
      return
    }
    if scheme == "about" || scheme == "data" || scheme == "blob" {
      decisionHandler(.allow)
      return
    }
    // External links (http, https, mailto, tel, geo…) go to the system.
    if navigationAction.navigationType == .linkActivated || navigationAction.targetFrame == nil {
      UIApplication.shared.open(url)
    }
    decisionHandler(.cancel)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    emitNavigation()
    onLoadEnd(["path": currentPath() ?? "", "title": lastNavigationPayload["title"] ?? ""])
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
    onLoadEnd(["path": currentPath() ?? "", "error": error.localizedDescription])
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
    let nsError = error as NSError
    if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
    if nsError.domain == "WebKitErrorDomain" && nsError.code == 102 { return } // frame load interrupted (policy cancel)
    onLoadEnd(["path": currentPath() ?? "", "error": error.localizedDescription])
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    webView.reload()
  }

  // MARK: - WKUIDelegate

  /// target="_blank" links: open in place (ZIM) or in the system browser.
  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = navigationAction.request.url {
      if url.scheme == ZimURL.scheme {
        webView.load(navigationAction.request)
      } else {
        UIApplication.shared.open(url)
      }
    }
    return nil
  }
}

enum ZimWebScripts {
  /// CSS for dark mode: invert the page, then re-invert media so photos look right.
  /// Math formulas (black glyph images) stay inverted so they remain readable.
  static let darkCSS = """
  html{filter:invert(1) hue-rotate(180deg)!important;background:#fff!important}
  img:not(.mwe-math-fallback-image-inline):not(.mwe-math-fallback-image-display),picture,video,canvas,iframe,embed,object,svg image,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)!important}
  """

  static func bootstrap(dark: Bool, zoom: Int) -> String {
    let css = darkCSS.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "`", with: "\\`")
    return """
    (function(){
      var state = { dark: \(dark), zoom: \(zoom) };
      var css = `\(css)`;
      function applyDark(){
        var el = document.getElementById('nomad-dark');
        if (state.dark) {
          if (!el) { el = document.createElement('style'); el.id = 'nomad-dark'; el.textContent = css; (document.head || document.documentElement).appendChild(el); }
        } else if (el) { el.remove(); }
      }
      function applyZoom(){
        var root = document.documentElement; if (!root) return;
        root.style.webkitTextSizeAdjust = state.zoom + '%';
        root.style.textSizeAdjust = state.zoom + '%';
      }
      window.__nomadApply = function(){ applyDark(); applyZoom(); };
      window.__nomadSetDark = function(on){ state.dark = !!on; applyDark(); };
      window.__nomadSetZoom = function(z){ state.zoom = z; applyZoom(); };
      window.__nomadApply();

      // Find in page: wrap matches in <mark>, keep an active index.
      var find = { q: '', marks: [], i: -1 };
      function clearMarks(){
        for (var k = 0; k < find.marks.length; k++) {
          var m = find.marks[k], p = m.parentNode;
          if (!p) continue;
          p.replaceChild(document.createTextNode(m.textContent), m);
          p.normalize();
        }
        find = { q: '', marks: [], i: -1 };
      }
      function markAll(q){
        var needle = q.toLowerCase(), nodes = [];
        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: function(n){
          var p = n.parentNode && n.parentNode.nodeName;
          if (p === 'SCRIPT' || p === 'STYLE' || p === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
          return n.nodeValue.toLowerCase().indexOf(needle) >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }});
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (var a = 0; a < nodes.length && find.marks.length < 1000; a++) {
          var node = nodes[a], text = node.nodeValue, lower = text.toLowerCase(), from = 0, idx, frag = document.createDocumentFragment();
          while ((idx = lower.indexOf(needle, from)) >= 0) {
            frag.appendChild(document.createTextNode(text.slice(from, idx)));
            var mark = document.createElement('mark');
            mark.className = 'nomad-find';
            mark.textContent = text.slice(idx, idx + q.length);
            frag.appendChild(mark);
            find.marks.push(mark);
            from = idx + q.length;
          }
          frag.appendChild(document.createTextNode(text.slice(from)));
          node.parentNode.replaceChild(frag, node);
        }
      }
      window.__nomadClearFind = clearMarks;
      window.__nomadFind = function(q, back){
        if (!document.body) return { found: false };
        if (!document.getElementById('nomad-find-style')) {
          var s = document.createElement('style'); s.id = 'nomad-find-style';
          s.textContent = 'mark.nomad-find{background:#FDE68A;color:#18171B;border-radius:2px}mark.nomad-find.active{background:#F2643A;color:#fff}';
          (document.head || document.documentElement).appendChild(s);
        }
        if (q !== find.q) { clearMarks(); find.q = q; markAll(q); find.i = -1; }
        var n = find.marks.length;
        if (!n) return { found: false, matches: 0, active: 0 };
        if (find.i >= 0) find.marks[find.i].classList.remove('active');
        find.i = find.i < 0 ? (back ? n - 1 : 0) : (find.i + (back ? -1 : 1) + n) % n;
        var cur = find.marks[find.i];
        cur.classList.add('active');
        cur.scrollIntoView({ block: 'center' });
        return { found: true, matches: n, active: find.i + 1 };
      };
    })();
    """
  }
}
