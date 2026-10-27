package expo.modules.nomadzim

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.SystemClock
import android.view.ContextThemeWrapper
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.ByteArrayInputStream
import java.io.InputStream

/**
 * android.webkit.WebView serving ZIM content from `https://<uuid>.zim.local/<path>`
 * via shouldInterceptRequest (an https origin so the page gets a normal secure
 * context, like kiwix-android does; one origin per archive, so archives can't read each
 * other's storage).
 *
 * Archive pages are untrusted third-party HTML/JS (any file can be imported): they get no
 * network (other hosts are intercepted, and a CSP covers what interception never sees,
 * like WebSockets), only their own archive, and can leave the app only through a tapped
 * link the reader confirms (`onExternalLink`).
 */
@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
class ZimWebView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onNavigationChange by EventDispatcher()
  val onLoadEnd by EventDispatcher()
  val onExternalLink by EventDispatcher()

  // Read by shouldInterceptRequest on WebView's IO thread.
  @Volatile
  var archiveId: String? = null
  var requestedPath: String? = null
  private var loadedArchiveId: String? = null
  private var loadedRequestedPath: String? = null
  private var hasLoaded = false

  @Volatile
  private var darkMode = false
  private var zoomPercent = 100
  private var lastPayload: Map<String, Any?> = emptyMap()

  private var lastFind: String? = null
  private var pendingFind: Promise? = null
  private val crashGuard = CrashGuard()

  /** Replaced by a fresh one when its renderer process dies (see [onRendererGone]). */
  lateinit var webView: WebView
    private set

  private val handle: ZimHandle?
    get() = archiveId?.let { ZimRegistry.get(it) }

  init {
    webView = createWebView()
    addView(webView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  private fun createWebView(): WebView {
    // Light theme context: pages always get prefers-color-scheme: light, our invert CSS is the only
    // dark mode (pages with their own dark rules would otherwise be inverted back to light).
    val view = WebView(ContextThemeWrapper(context, android.R.style.Theme_DeviceDefault_Light))
    view.setBackgroundColor(Color.TRANSPARENT)
    view.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      allowFileAccess = false
      allowContentAccess = false
      mediaPlaybackRequiresUserGesture = true
      // Desktop-layout pages without a viewport meta fit the screen, like WKWebView does.
      useWideViewPort = true
      loadWithOverviewMode = true
      builtInZoomControls = true
      displayZoomControls = false
      setSupportMultipleWindows(false)
      textZoom = zoomPercent
    }
    view.webViewClient = Client()
    view.setFindListener { active, matches, done ->
      if (done) {
        pendingFind?.resolve(mapOf("found" to (matches > 0), "matches" to matches, "active" to if (matches > 0) active + 1 else 0))
        pendingFind = null
      }
    }
    return view
  }

  // region Loading

  fun loadRequestedIfNeeded() {
    val id = archiveId ?: return
    if (hasLoaded && loadedArchiveId == id && loadedRequestedPath == requestedPath) return
    if (handle == null) return
    hasLoaded = true
    loadedArchiveId = id
    loadedRequestedPath = requestedPath
    load(requestedPath ?: "")
  }

  fun load(rawPath: String) {
    val h = handle ?: return
    var path = rawPath
    var fragment: String? = null
    val hash = path.indexOf('#')
    if (hash >= 0) {
      fragment = path.substring(hash + 1)
      path = path.substring(0, hash)
    }
    path = path.removePrefix("/")
    if (path.isEmpty()) path = h.mainPath ?: ""
    val info = h.entryInfo(path)
    if (info != null && ZimExternalOpen.wants(info.mimeType)) return openInViewer(h, info.path)
    info?.let { path = it.path }
    webView.loadUrl(zimUrl(h.uuid, path, fragment))
  }

  /** A PDF goes to the system viewer (the WebView would stay blank); `onLoadEnd` reports `noViewer`. */
  private fun openInViewer(h: ZimHandle, path: String) {
    Thread {
      if (!ZimExternalOpen.open(context, appContext.currentActivity, h, path)) {
        post { onLoadEnd(mapOf("path" to path, "error" to "noViewer")) }
      }
    }.start()
  }

  /** The only archive this view serves: its own item's, by id, never another item that shares the UUID. */
  private fun handleFor(uri: Uri): ZimHandle? {
    val h = handle ?: return null
    return h.takeIf { uuidOf(uri) == it.uuid }
  }

  /**
   * The renderer died (crash, or killed for memory) and took the WebView with it: swap in a
   * fresh one and reload the page, but a page that keeps killing it gets an error instead of
   * an endless loop.
   */
  private fun onRendererGone(dead: WebView) {
    val current = dead === webView
    val path = if (current) currentPath(dead.url) ?: lastPayload["path"] as? String else null
    removeView(dead)
    dead.destroy()
    if (!current) return
    webView = createWebView()
    addView(webView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    // React Native doesn't lay out children added after the fact.
    measureAndLayout()
    lastPayload = emptyMap()
    lastFind = null
    pendingFind?.resolve(mapOf("found" to false))
    pendingFind = null
    if (path != null && crashGuard.shouldReload(path, SystemClock.elapsedRealtime())) {
      load(path)
    } else {
      onLoadEnd(mapOf("path" to (path ?: ""), "error" to "renderer process gone", "crashed" to true))
    }
  }

  // endregion

  // region Appearance

  fun setDarkMode(on: Boolean) {
    if (on == darkMode) return
    darkMode = on
    webView.evaluateJavascript(if (on) ENABLE_DARK_JS else DISABLE_DARK_JS, null)
  }

  fun setTextZoom(percent: Int) {
    zoomPercent = percent.coerceIn(50, 300)
    webView.settings.textZoom = zoomPercent
  }

  // endregion

  // region Find

  fun find(text: String, backwards: Boolean, promise: Promise) {
    pendingFind?.resolve(mapOf("found" to false))
    if (text.isEmpty()) {
      clearFind()
      promise.resolve(mapOf("found" to false))
      return
    }
    pendingFind = promise
    if (text != lastFind) {
      lastFind = text
      webView.findAllAsync(text)
    } else {
      webView.findNext(!backwards)
    }
  }

  fun clearFind() {
    lastFind = null
    webView.clearMatches()
  }

  // endregion

  // region Events

  private fun currentPath(url: String? = webView.url): String? {
    val uri = url?.let(Uri::parse) ?: return null
    if (uuidOf(uri) == null) return null
    return pathOf(uri)
  }

  private fun emitNavigation(url: String? = webView.url) {
    val path = currentPath(url) ?: return
    // libzim gives an entry without a title its path ("home" on nautilus collections): the
    // page's own <title> is better then.
    val entryTitle = handle?.entryInfo(path)?.title.orEmpty()
    val pageTitle = webView.title.orEmpty()
    val title = if (entryTitle.isEmpty() || (entryTitle == path && pageTitle.isNotEmpty())) pageTitle else entryTitle
    val payload = mapOf(
      "path" to path,
      "title" to title,
      "canGoBack" to webView.canGoBack(),
      "canGoForward" to webView.canGoForward(),
    )
    if (payload == lastPayload) return
    lastPayload = payload
    onNavigationChange(payload)
  }

  // endregion

  private inner class Client : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
      val uri = request.url
      if (uuidOf(uri) != null) {
        if (request.isForMainFrame) {
          val h = handleFor(uri) ?: return false
          val path = pathOf(uri)
          val info = h.entryInfo(path)
          if (info != null && ZimExternalOpen.wants(info.mimeType)) {
            openInViewer(h, info.path)
            return true
          }
          if (info != null && info.path != path) {
            view.loadUrl(zimUrl(h.uuid, info.path, uri.fragment))
            return true
          }
        }
        return false
      }
      val scheme = uri.scheme?.lowercase()
      if (scheme == "about" || scheme == "blob" || scheme == "javascript") return false
      // A top-level data: document has no CSP: its WebSockets would reach the network.
      if (scheme == "data") return request.isForMainFrame
      // Leaving the app: only a link the user tapped in the page itself (this runs for
      // script navigations and iframes too), with a scheme the system handles for a reader.
      // The reader asks before opening it.
      if (request.isForMainFrame && request.hasGesture()) externalLinkEvent(uri)?.let { onExternalLink(it) }
      return true
    }

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
      val uri = request.url
      if (uuidOf(uri) == null) {
        // Offline app: block every other network request made by content.
        return if (uri.scheme == "http" || uri.scheme == "https") notFound() else null
      }
      val h = handleFor(uri) ?: return notFound()
      val info = h.entryInfo(pathOf(uri)) ?: return notFound()
      val mime = normalizedMime(info.mimeType, info.path)
      val encoding = if (isText(mime)) "utf-8" else null
      val size = info.size
      val headers = mutableMapOf(
        "Accept-Ranges" to "bytes",
        "Cache-Control" to "max-age=86400",
        "Content-Security-Policy" to CONTENT_SECURITY_POLICY,
        "X-DNS-Prefetch-Control" to "off",
      )

      val rangeHeader = request.requestHeaders.entries.firstOrNull { it.key.equals("Range", ignoreCase = true) }?.value
      val range = parseRange(rangeHeader, size)
      if (range != null) {
        val length = minOf(range.last - range.first + 1, MAX_RANGE_CHUNK)
        val bytes = h.data(info.path, range.first, length) ?: return notFound()
        headers["Content-Range"] = "bytes ${range.first}-${range.first + bytes.size - 1}/$size"
        headers["Content-Length"] = bytes.size.toString()
        return WebResourceResponse(mime, encoding, 206, "Partial Content", headers, ByteArrayInputStream(bytes))
      }

      if (mime == "text/html" && request.isForMainFrame) {
        val html = h.data(info.path) ?: return notFound()
        val body = if (darkMode) injectDarkStyle(String(html, Charsets.UTF_8)).toByteArray(Charsets.UTF_8) else html
        headers["Content-Length"] = body.size.toString()
        return WebResourceResponse(mime, encoding, 200, "OK", headers, ByteArrayInputStream(body))
      }

      headers["Content-Length"] = size.toString()
      val stream: InputStream = if (size > STREAM_CHUNK) {
        ChunkedItemStream(h, info.path, size)
      } else {
        ByteArrayInputStream(h.data(info.path) ?: return notFound())
      }
      return WebResourceResponse(mime, encoding, 200, "OK", headers, stream)
    }

    override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
      emitNavigation(url)
    }

    override fun onPageFinished(view: WebView, url: String?) {
      if (darkMode) view.evaluateJavascript(NATIVE_DARK_JS, null)
      emitNavigation(url)
      onLoadEnd(mapOf("path" to (currentPath(url) ?: ""), "title" to (lastPayload["title"] ?: "")))
    }

    // The default (false) takes the whole app down with the renderer.
    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
      onRendererGone(view)
      return true
    }
  }

  /** Streams a large item in chunks so a big video never sits fully in memory. */
  private class ChunkedItemStream(private val h: ZimHandle, private val path: String, private val size: Long) : InputStream() {
    private var offset = 0L
    private var buf = ByteArray(0)
    private var pos = 0

    private fun fill(): Boolean {
      if (pos < buf.size) return true
      if (offset >= size) return false
      buf = h.data(path, offset, STREAM_CHUNK) ?: return false
      if (buf.isEmpty()) return false
      offset += buf.size
      pos = 0
      return true
    }

    override fun read(): Int = if (!fill()) -1 else buf[pos++].toInt() and 0xff

    override fun read(b: ByteArray, off: Int, len: Int): Int {
      if (!fill()) return -1
      val n = minOf(len, buf.size - pos)
      System.arraycopy(buf, pos, b, off, n)
      pos += n
      return n
    }
  }

  /** Whether a page whose renderer died may be reloaded: once per page, and only a few times a minute. */
  private class CrashGuard {
    private val recent = mutableListOf<Pair<String, Long>>()

    fun shouldReload(page: String, now: Long): Boolean {
      recent.removeAll { now - it.second > CRASH_WINDOW_MS }
      val again = recent.any { it.first == page }
      recent.add(page to now)
      return !again && recent.size <= MAX_CRASHES_PER_WINDOW
    }
  }

  companion object {
    const val HOST_SUFFIX = ".zim.local"
    private const val MAX_RANGE_CHUNK = 4L * 1024 * 1024
    private const val STREAM_CHUNK = 2L * 1024 * 1024
    private const val CRASH_WINDOW_MS = 60_000L
    private const val MAX_CRASHES_PER_WINDOW = 3

    /**
     * Archive pages may load only from their own origin, data: and blob:. Inline scripts,
     * styles and eval stay allowed (archive apps and our dark-mode style need them). Sent on
     * every response because workers take their policy from their own script's response.
     */
    private const val CONTENT_SECURITY_POLICY =
      "default-src 'self' data: blob: about: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'"

    /** Schemes the system handles for a reader (browser, mail, phone, maps). */
    private val EXTERNAL_SCHEMES = setOf("http", "https", "mailto", "tel", "geo")
    private val FORMAT_CHARS = Regex("\\p{Cf}")

    // Pages that are dark by design get data-nomad-native-dark (see NATIVE_DARK_JS) and are left alone.
    private const val DARK_CSS =
      "html:not([data-nomad-native-dark]){filter:invert(1) hue-rotate(180deg)!important;background:#fff!important}" +
        "html:not([data-nomad-native-dark]) :is(img:not(.mwe-math-fallback-image-inline):not(.mwe-math-fallback-image-display),picture,video,canvas,iframe,embed,object,svg image,[style*=\"background-image\"]){filter:invert(1) hue-rotate(180deg)!important}"

    /** Marks pages whose authored background (our style off) is already dark. */
    private const val NATIVE_DARK_JS = """(function(){
      var el = document.getElementById('nomad-dark'); if (!el || !document.body) return;
      el.disabled = true;
      var bg = [document.body, document.documentElement].map(function(n){ return getComputedStyle(n).backgroundColor; })
        .map(function(c){ return (c.match(/[\d.]+/g) || []).map(Number); })
        .filter(function(v){ return v.length >= 3 && (v.length < 4 || v[3] > 0.5); })[0];
      el.disabled = false;
      var lum = 1;
      if (bg) {
        var lin = bg.slice(0, 3).map(function(v){ v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
      }
      document.documentElement.toggleAttribute('data-nomad-native-dark', lum < 0.2);
    })();"""

    private const val ENABLE_DARK_JS =
      "(function(){if(document.getElementById('nomad-dark'))return;var s=document.createElement('style');s.id='nomad-dark';" +
        "s.textContent=" + "'" + DARK_CSS + "'" + ";(document.head||document.documentElement).appendChild(s);})();" + NATIVE_DARK_JS

    private const val DISABLE_DARK_JS = "(function(){var s=document.getElementById('nomad-dark');if(s)s.remove();})();"

    private val HEAD_TAG = Regex("<head[^>]*>", RegexOption.IGNORE_CASE)

    fun injectDarkStyle(html: String): String {
      val style = "<style id=\"nomad-dark\">$DARK_CSS</style>"
      val m = HEAD_TAG.find(html) ?: return style + html
      return html.substring(0, m.range.last + 1) + style + html.substring(m.range.last + 1)
    }

    fun zimUrl(uuid: String, path: String, fragment: String?): String {
      val encoded = path.split('/').joinToString("/") { Uri.encode(it) }
      return "https://$uuid$HOST_SUFFIX/$encoded" + (fragment?.takeIf { it.isNotEmpty() }?.let { "#$it" } ?: "")
    }

    /** Archive UUID of a `https://<uuid>.zim.local/<path>` URL, or null for any other URL. */
    fun uuidOf(uri: Uri): String? {
      if (uri.scheme != "https" && uri.scheme != "http") return null
      val host = uri.host?.lowercase() ?: return null
      if (!host.endsWith(HOST_SUFFIX)) return null
      return host.removeSuffix(HOST_SUFFIX).takeIf { it.isNotEmpty() }
    }

    /** Decoded ZIM path of a zim.local URL (no leading slash, query dropped). */
    fun pathOf(uri: Uri): String = Uri.decode((uri.encodedPath ?: "").removePrefix("/"))

    /** `{url, label}` for the reader's confirmation (label: the host, or the address or number), or null when it may not leave. */
    fun externalLinkEvent(uri: Uri): Map<String, String>? {
      val scheme = uri.scheme?.lowercase() ?: return null
      if (scheme !in EXTERNAL_SCHEMES) return null
      val raw = if (scheme == "http" || scheme == "https") uri.host.orEmpty() else uri.schemeSpecificPart.orEmpty().substringBefore('?')
      // Shown as the destination: no bidi overrides or other invisible format characters.
      val label = raw.replace(FORMAT_CHARS, "").take(200)
      if (label.isEmpty()) return null
      return mapOf("url" to uri.toString(), "label" to label)
    }

    fun parseRange(header: String?, size: Long): LongRange? {
      if (header == null || size <= 0 || !header.startsWith("bytes=")) return null
      val spec = header.removePrefix("bytes=").split(',').first().trim()
      val parts = spec.split('-')
      if (parts.size != 2) return null
      val a = parts[0].trim()
      val b = parts[1].trim()
      if (a.isEmpty()) {
        val n = b.toLongOrNull() ?: return null
        if (n <= 0) return null
        return maxOf(0, size - n)..(size - 1)
      }
      val start = a.toLongOrNull() ?: return null
      if (start >= size) return null
      val end = if (b.isEmpty()) size - 1 else minOf(b.toLongOrNull() ?: (size - 1), size - 1)
      if (end < start) return null
      return start..end
    }

    fun normalizedMime(raw: String, path: String): String {
      var mime = raw.substringBefore(';').trim().lowercase()
      if (mime.isEmpty() || mime == "application/octet-stream") {
        mime = android.webkit.MimeTypeMap.getSingleton()
          .getMimeTypeFromExtension(path.substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"
      }
      return mime
    }

    private fun isText(mime: String) =
      mime.startsWith("text/") || mime == "application/javascript" || mime == "application/json" || mime == "image/svg+xml"

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
  }
}
