package expo.modules.nomadzim

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
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
 * android.webkit.WebView serving ZIM content from `https://zim.local/<uuid>/<path>`
 * via shouldInterceptRequest (an https origin so the page gets a normal secure
 * context, like kiwix-android does).
 */
@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
class ZimWebView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onNavigationChange by EventDispatcher()
  val onLoadEnd by EventDispatcher()

  val webView = WebView(context)

  var archiveId: String? = null
  var requestedPath: String? = null
  private var loadedArchiveId: String? = null
  private var loadedRequestedPath: String? = null
  private var hasLoaded = false

  @Volatile
  private var darkMode = false
  private var lastPayload: Map<String, Any?> = emptyMap()

  private var lastFind: String? = null
  private var pendingFind: Promise? = null

  private val handle: ZimHandle?
    get() = archiveId?.let { ZimRegistry.get(it) }

  init {
    webView.setBackgroundColor(Color.TRANSPARENT)
    webView.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      allowFileAccess = false
      allowContentAccess = false
      mediaPlaybackRequiresUserGesture = true
      builtInZoomControls = true
      displayZoomControls = false
      setSupportMultipleWindows(false)
    }
    webView.webViewClient = Client()
    webView.setFindListener { active, matches, done ->
      if (done) {
        pendingFind?.resolve(mapOf("found" to (matches > 0), "matches" to matches, "active" to if (matches > 0) active + 1 else 0))
        pendingFind = null
      }
    }
    addView(webView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
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
    h.entryInfo(path)?.let { path = it.path }
    webView.loadUrl(zimUrl(h.uuid, path, fragment))
  }

  // endregion

  // region Appearance

  fun setDarkMode(on: Boolean) {
    if (on == darkMode) return
    darkMode = on
    webView.evaluateJavascript(if (on) ENABLE_DARK_JS else DISABLE_DARK_JS, null)
  }

  fun setTextZoom(percent: Int) {
    webView.settings.textZoom = percent.coerceIn(50, 300)
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
    if (uri.host != HOST) return null
    return pathOf(uri)?.second
  }

  private fun emitNavigation(url: String? = webView.url) {
    val path = currentPath(url) ?: return
    val title = handle?.entryInfo(path)?.title?.takeIf { it.isNotEmpty() } ?: (webView.title ?: "")
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
      if (uri.host == HOST && (uri.scheme == "https" || uri.scheme == "http")) {
        if (request.isForMainFrame) {
          val h = pathOf(uri)?.let { ZimRegistry.byUuid(it.first) } ?: return false
          val path = pathOf(uri)!!.second
          val info = h.entryInfo(path)
          if (info != null && info.path != path) {
            view.loadUrl(zimUrl(h.uuid, info.path, uri.fragment))
            return true
          }
        }
        return false
      }
      if (uri.scheme == "about" || uri.scheme == "data" || uri.scheme == "blob" || uri.scheme == "javascript") return false
      try {
        context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      } catch (_: ActivityNotFoundException) {
        // No app to handle it.
      }
      return true
    }

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
      val uri = request.url
      if (uri.host != HOST) {
        // Offline app: block every other network request made by content.
        return if (uri.scheme == "http" || uri.scheme == "https") notFound() else null
      }
      val (uuid, path) = pathOf(uri) ?: return notFound()
      val h = ZimRegistry.byUuid(uuid) ?: return notFound()
      val info = h.entryInfo(path) ?: return notFound()
      val mime = normalizedMime(info.mimeType, info.path)
      val encoding = if (isText(mime)) "utf-8" else null
      val size = info.size
      val headers = mutableMapOf("Accept-Ranges" to "bytes", "Cache-Control" to "max-age=86400", "Access-Control-Allow-Origin" to "*")

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
      emitNavigation(url)
      onLoadEnd(mapOf("path" to (currentPath(url) ?: ""), "title" to (lastPayload["title"] ?: "")))
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

  companion object {
    const val HOST = "zim.local"
    private const val MAX_RANGE_CHUNK = 4L * 1024 * 1024
    private const val STREAM_CHUNK = 2L * 1024 * 1024

    private const val DARK_CSS =
      "html{filter:invert(1) hue-rotate(180deg)!important;background:#fff!important}" +
        "img:not(.mwe-math-fallback-image-inline):not(.mwe-math-fallback-image-display),picture,video,canvas,iframe,embed,object,svg image,[style*=\"background-image\"]{filter:invert(1) hue-rotate(180deg)!important}"

    private const val ENABLE_DARK_JS =
      "(function(){if(document.getElementById('nomad-dark'))return;var s=document.createElement('style');s.id='nomad-dark';" +
        "s.textContent=" + "'" + DARK_CSS + "'" + ";(document.head||document.documentElement).appendChild(s);})();"

    private const val DISABLE_DARK_JS = "(function(){var s=document.getElementById('nomad-dark');if(s)s.remove();})();"

    private val HEAD_TAG = Regex("<head[^>]*>", RegexOption.IGNORE_CASE)

    fun injectDarkStyle(html: String): String {
      val style = "<style id=\"nomad-dark\">$DARK_CSS</style>"
      val m = HEAD_TAG.find(html) ?: return style + html
      return html.substring(0, m.range.last + 1) + style + html.substring(m.range.last + 1)
    }

    fun zimUrl(uuid: String, path: String, fragment: String?): String {
      val encoded = path.split('/').joinToString("/") { Uri.encode(it) }
      return "https://$HOST/$uuid/$encoded" + (fragment?.takeIf { it.isNotEmpty() }?.let { "#$it" } ?: "")
    }

    /** (uuid, decoded ZIM path) of a `https://zim.local/<uuid>/<path>` URL. */
    fun pathOf(uri: Uri): Pair<String, String>? {
      val encoded = uri.encodedPath ?: return null
      val trimmed = encoded.removePrefix("/")
      val slash = trimmed.indexOf('/')
      if (slash <= 0) return if (trimmed.isNotEmpty()) Pair(trimmed, "") else null
      return Pair(trimmed.substring(0, slash), Uri.decode(trimmed.substring(slash + 1)))
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
