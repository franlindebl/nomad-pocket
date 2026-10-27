import ExpoModulesCore
import UIKit
import WebKit

/// WKWebView that renders ZIM content through `zim://<uuid>/<path>`.
///
/// Archive pages are untrusted third-party HTML/JS (any file can be imported): they get
/// no network (content rule list + CSP), only their own archive, and can leave the app
/// only through a tapped link the reader confirms (`onExternalLink`).
final class ZimWebView: ExpoView, WKNavigationDelegate, WKUIDelegate {
  let onNavigationChange = EventDispatcher()
  let onLoadEnd = EventDispatcher()
  let onExternalLink = EventDispatcher()

  /// Website data (IndexedDB, localStorage) of ZIM pages, kept apart from other web views.
  private static let dataStoreID = UUID(uuidString: "6E0D7A1C-3B2F-4C55-9A61-5F2E8B9D4C01")!

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
  /// Loads wait for the offline content rule list (compiled once per launch, async).
  private var rulesReady = false
  private var pendingLoad: String?
  private var crashGuard = ZimCrashGuard()

  required init(appContext: AppContext? = nil) {
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(schemeHandler, forURLScheme: ZimURL.scheme)
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = .all
    config.dataDetectorTypes = []
    // Persistent store: on custom-scheme origins the ephemeral store can't put Blobs in
    // IndexedDB (UnknownError), which hangs PouchDB-based archives (nautilus/zimgit).
    if #available(iOS 17.0, *) {
      config.websiteDataStore = WKWebsiteDataStore(forIdentifier: Self.dataStoreID)
    } else {
      config.websiteDataStore = .default()
    }
    webView = WKWebView(frame: .zero, configuration: config)
    super.init(appContext: appContext)

    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true
    // Pages always render in their light scheme; our invert CSS is the only dark mode.
    // Otherwise pages with prefers-color-scheme rules (recent MediaWiki dumps) go dark
    // by themselves and the inversion turns them light again.
    webView.overrideUserInterfaceStyle = .light
    webView.isOpaque = false
    webView.backgroundColor = .clear
    webView.scrollView.backgroundColor = .clear
    webView.scrollView.contentInsetAdjustmentBehavior = .automatic
    #if DEBUG
    if #available(iOS 16.4, *) {
      webView.isInspectable = true
    }
    #endif
    addSubview(webView)
    installUserScripts()
    schemeHandler.resolveArchive = { [weak self] host in self?.archive(forHost: host) }
    ZimContentRules.whenReady { [weak self] rules in
      guard let self else { return }
      if let rules { self.webView.configuration.userContentController.add(rules) }
      self.rulesReady = true
      if let path = self.pendingLoad {
        self.pendingLoad = nil
        self.load(path: path)
      }
    }

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

  /// The only archive the scheme handler serves: this view's item, by id. Another item
  /// with the same UUID (a re-import, or a crafted file) never answers for it.
  private func archive(forHost host: String) -> NZArchive? {
    guard let archive, archive.uuid.lowercased() == host.lowercased() else { return nil }
    return archive
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
    guard rulesReady else {
      pendingLoad = rawPath
      return
    }
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
    // libzim gives an entry without a title its path ("home" on nautilus collections): the
    // page's own <title> is better then.
    let entryTitle = archive?.entryInfo(atPath: path)?.title ?? ""
    let pageTitle = webView.title ?? ""
    let title = entryTitle.isEmpty || (entryTitle == path && !pageTitle.isEmpty) ? pageTitle : entryTitle
    let payload: [String: AnyHashable] = [
      "path": path,
      "title": title,
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
    decisionHandler(.cancel)
    // Leaving the app: only a tapped link (scripted location changes are .other) in the
    // page or a new window, with a scheme the system handles for a reader. The reader
    // asks before opening it, so a synthetic click can't launch anything by itself.
    let tapped = navigationAction.navigationType == .linkActivated
    let topLevel = navigationAction.targetFrame?.isMainFrame ?? true
    if tapped, topLevel, let event = ZimExternalLink.event(for: url) {
      onExternalLink(event)
    }
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

  /// The web process died (memory, or a hostile page): reload, but a page that keeps
  /// killing it gets an error instead of an endless reload loop.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    let path = currentPath() ?? (lastNavigationPayload["path"] as? String)
    guard crashGuard.shouldReload(path) else {
      onLoadEnd(["path": path ?? "", "error": "web content process terminated", "crashed": true])
      return
    }
    if webView.url != nil {
      webView.reload()
    } else if let path {
      load(path: path)
    }
  }

  // MARK: - WKUIDelegate

  /// target="_blank" ZIM links open in place. External ones never get here: the
  /// navigation delegate cancels them first.
  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = navigationAction.request.url, url.scheme == ZimURL.scheme {
      webView.load(navigationAction.request)
    }
    return nil
  }
}

/// Links that may leave the app: schemes the system handles for a reader (browser, mail,
/// phone, maps). App deep links, file: and the rest are dropped.
enum ZimExternalLink {
  static let schemes: Set<String> = ["http", "https", "mailto", "tel", "geo"]

  /// `{url, label}` for the reader's confirmation (label: the host, or the address or
  /// number of mailto/tel/geo), or nil when the URL may not leave the app.
  static func event(for url: URL) -> [String: String]? {
    guard let scheme = url.scheme?.lowercased(), schemes.contains(scheme) else { return nil }
    var label: String
    if scheme == "http" || scheme == "https" {
      label = url.host ?? ""
    } else {
      label = URLComponents(url: url, resolvingAgainstBaseURL: false)?.path ?? ""
    }
    // Shown as the destination: no bidi overrides or other invisible format characters.
    var scalars = String.UnicodeScalarView()
    scalars.append(contentsOf: label.unicodeScalars.filter { $0.properties.generalCategory != .format })
    label = String(String(scalars).prefix(200))
    guard !label.isEmpty else { return nil }
    return ["url": url.absoluteString, "label": label]
  }
}

/// Whether a page whose web process died may be reloaded: once per page, and only a few
/// times a minute, so a page that always crashes (too big, or hostile) can't loop.
struct ZimCrashGuard {
  static let window: TimeInterval = 60
  static let maxPerWindow = 3
  private var recent: [(page: String, at: Date)] = []

  mutating func shouldReload(_ page: String?, now: Date = Date()) -> Bool {
    recent.removeAll { now.timeIntervalSince($0.at) > Self.window }
    let again = recent.contains { $0.page == page }
    recent.append((page ?? "", now))
    return page != nil && !again && recent.count <= Self.maxPerWindow
  }
}

/// Content rule list that blocks every network load archive pages make (images, scripts,
/// styles, fonts, media, fetch/XHR, beacons, WebSockets), also from documents the CSP
/// header doesn't reach (data: URLs). Navigations are decided in decidePolicyFor before
/// it applies, so tapped external links still reach the reader's confirmation.
enum ZimContentRules {
  private static let identifier = "nomad-zim-offline-1"
  // url-filter has no alternation: one rule per scheme.
  private static let json = """
  [
    {"trigger": {"url-filter": "^https?:"}, "action": {"type": "block"}},
    {"trigger": {"url-filter": "^wss?:"}, "action": {"type": "block"}},
    {"trigger": {"url-filter": "^ftp:"}, "action": {"type": "block"}}
  ]
  """

  // Main thread only.
  private static var compiled: WKContentRuleList?
  private static var done = false
  private static var waiting: [(WKContentRuleList?) -> Void] = []

  /// Calls `ready` on the main thread with the compiled list (nil if compiling failed:
  /// the CSP header still applies then).
  static func whenReady(_ ready: @escaping (WKContentRuleList?) -> Void) {
    if done {
      ready(compiled)
      return
    }
    waiting.append(ready)
    guard waiting.count == 1 else { return }
    WKContentRuleListStore.default().compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: json) { list, error in
      DispatchQueue.main.async {
        if let error { NSLog("[nomad-zim] content rule list failed: %@", String(describing: error)) }
        compiled = list
        done = true
        let callbacks = waiting
        waiting = []
        callbacks.forEach { $0(list) }
      }
    }
  }
}

enum ZimWebScripts {
  /// CSS for dark mode: invert the page, then re-invert media so photos look right.
  /// Math formulas (black glyph images) stay inverted so they remain readable.
  /// Pages that are dark by design get `data-nomad-native-dark` and are left alone.
  static let darkCSS = """
  html:not([data-nomad-native-dark]){filter:invert(1) hue-rotate(180deg)!important;background:#fff!important}
  html:not([data-nomad-native-dark]) :is(img:not(.mwe-math-fallback-image-inline):not(.mwe-math-fallback-image-display),picture,video,canvas,iframe,embed,object,svg image,[style*="background-image"]){filter:invert(1) hue-rotate(180deg)!important}
  """

  static func bootstrap(dark: Bool, zoom: Int) -> String {
    let css = darkCSS.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "`", with: "\\`")
    return """
    (function(){
      var state = { dark: \(dark), zoom: \(zoom) };
      var css = `\(css)`;
      // Background luminance of the page as authored (our style off), or null when unknown.
      function pageLuminance(el){
        if (!document.body) return null;
        if (el) el.disabled = true;
        var bg = [document.body, document.documentElement].map(function(n){ return getComputedStyle(n).backgroundColor; })
          .map(function(c){ return (c.match(/[\\d.]+/g) || []).map(Number); })
          .filter(function(v){ return v.length >= 3 && (v.length < 4 || v[3] > 0.5); })[0];
        if (el) el.disabled = false;
        if (!bg) return 1; // transparent: the browser default, white
        var lin = bg.slice(0, 3).map(function(v){ v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
      }
      function applyDark(){
        var el = document.getElementById('nomad-dark');
        if (state.dark) {
          if (!el) { el = document.createElement('style'); el.id = 'nomad-dark'; el.textContent = css; (document.head || document.documentElement).appendChild(el); }
          var lum = pageLuminance(el);
          if (lum !== null) document.documentElement.toggleAttribute('data-nomad-native-dark', lum < 0.2);
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
      // Stylesheets may finish after DOMContentLoaded: check the page background again.
      window.addEventListener('load', applyDark);

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
