package expo.modules.nomadzim

import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ArchiveNotOpenException(id: String) : CodedException("ZIM archive '$id' is not open")

class OpenFailedException(message: String) : CodedException(message)

/** Largest entry getContent returns (articles are far smaller; HTML-wrapped books may reach a few MB). */
private const val MAX_CONTENT_BYTES = 8L * 1024 * 1024

class NomadZimModule : Module() {
  private val context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  private fun handle(id: String): ZimHandle = ZimRegistry.get(id) ?: throw ArchiveNotOpenException(id)

  override fun definition() = ModuleDefinition {
    Name("NomadZim")

    // All libzim work runs on Dispatchers.IO: never the JS or main thread.
    AsyncFunction("openArchive") Coroutine { id: String, path: String ->
      withContext(Dispatchers.IO) {
        val h = try {
          ZimRegistry.open(context, id, plainPath(path))
        } catch (e: Throwable) {
          throw OpenFailedException("Cannot open ZIM file: ${e.message}")
        }
        info(h)
      }
    }

    Function("closeArchive") { id: String ->
      ZimRegistry.close(id)
    }

    Function("isOpen") { id: String ->
      ZimRegistry.get(id) != null
    }

    AsyncFunction("suggest") Coroutine { id: String, query: String, limit: Int ->
      withContext(Dispatchers.IO) { handle(id).suggest(query, limit).map(::hit) }
    }

    AsyncFunction("search") Coroutine { id: String, query: String, limit: Int ->
      withContext(Dispatchers.IO) { handle(id).search(query, limit).map(::hit) }
    }

    AsyncFunction("getEntry") Coroutine { id: String, path: String ->
      withContext(Dispatchers.IO) {
        handle(id).entryInfo(path)?.let {
          mapOf("path" to it.path, "title" to it.title, "mimeType" to it.mimeType, "size" to it.size.toDouble(), "redirect" to it.wasRedirect)
        }
      }
    }

    // Null for binary or oversized entries, checked before reading: the whole entry becomes
    // one string bridged to JS (a PDF or video the reader shows would otherwise be read and
    // decoded only to be thrown away).
    AsyncFunction("getContent") Coroutine { id: String, path: String ->
      withContext(Dispatchers.IO) {
        val h = handle(id)
        val info = h.entryInfo(path) ?: return@withContext null
        if (!isText(info.mimeType) || info.size > MAX_CONTENT_BYTES) return@withContext null
        val bytes = h.data(info.path) ?: return@withContext null
        mapOf("path" to info.path, "title" to info.title, "mimeType" to info.mimeType, "content" to String(bytes, Charsets.UTF_8))
      }
    }

    AsyncFunction("getMainPath") Coroutine { id: String ->
      withContext(Dispatchers.IO) { handle(id).mainPath }
    }

    AsyncFunction("randomPath") Coroutine { id: String ->
      withContext(Dispatchers.IO) {
        val h = handle(id)
        repeat(8) {
          val p = h.randomPath() ?: return@repeat
          val info = h.entryInfo(p)
          if (info != null && info.mimeType.startsWith("text/html")) return@withContext info.path
        }
        h.randomPath()
      }
    }

    AsyncFunction("listArticles") Coroutine { id: String, limit: Int ->
      withContext(Dispatchers.IO) { handle(id).listArticles(limit).map(::hit) }
    }

    // iOS-only (per-file iCloud backup flag). On Android the content folders are excluded by
    // path in the backup rules (plugins/with-android-backup-rules.js).
    AsyncFunction("excludeFromBackup") { _: String -> false }

    View(ZimWebView::class) {
      Events("onNavigationChange", "onLoadEnd")

      Prop("archiveId") { view: ZimWebView, id: String? -> view.archiveId = id }
      Prop("path") { view: ZimWebView, path: String? -> view.requestedPath = path }
      Prop("darkMode") { view: ZimWebView, on: Boolean? -> view.setDarkMode(on ?: false) }
      Prop("textZoom") { view: ZimWebView, percent: Double? -> view.setTextZoom((percent ?: 100.0).toInt()) }

      OnViewDidUpdateProps { view: ZimWebView -> view.loadRequestedIfNeeded() }

      // View functions run on the main thread.
      AsyncFunction("goBack") { view: ZimWebView -> if (view.webView.canGoBack()) view.webView.goBack() }
      AsyncFunction("goForward") { view: ZimWebView -> if (view.webView.canGoForward()) view.webView.goForward() }
      AsyncFunction("reload") { view: ZimWebView -> view.webView.reload() }
      AsyncFunction("loadPath") { view: ZimWebView, path: String -> view.load(path) }
      AsyncFunction("setTextZoom") { view: ZimWebView, percent: Double -> view.setTextZoom(percent.toInt()) }
      AsyncFunction("setDarkMode") { view: ZimWebView, on: Boolean -> view.setDarkMode(on) }
      AsyncFunction("findInPage") { view: ZimWebView, text: String, backwards: Boolean?, promise: Promise ->
        view.find(text, backwards ?: false, promise)
      }
      AsyncFunction("clearFind") { view: ZimWebView -> view.clearFind() }
    }
  }

  private fun isText(mimeType: String): Boolean {
    val mime = mimeType.lowercase()
    return mime.startsWith("text/") || "json" in mime || "xml" in mime || "javascript" in mime
  }

  private fun plainPath(uri: String): String =
    if (uri.startsWith("file://")) android.net.Uri.parse(uri).path ?: uri.removePrefix("file://") else uri

  private fun hit(h: ZimHit): Map<String, Any?> {
    val out = mutableMapOf<String, Any?>("path" to h.path, "title" to h.title)
    h.snippet?.let { out["snippet"] = it }
    h.wordCount?.let { out["wordCount"] = it }
    return out
  }

  private fun info(h: ZimHandle): Map<String, Any?> {
    val a = h.archive
    val illustration = h.illustrationPng(48)?.let { "data:image/png;base64," + Base64.encodeToString(it, Base64.NO_WRAP) }
    return mapOf(
      "uuid" to h.uuid,
      "title" to (h.metadata("Title") ?: ""),
      "description" to (h.metadata("Description") ?: ""),
      "language" to (h.metadata("Language") ?: ""),
      "creator" to (h.metadata("Creator") ?: ""),
      "publisher" to (h.metadata("Publisher") ?: ""),
      "date" to (h.metadata("Date") ?: ""),
      "name" to (h.metadata("Name") ?: ""),
      "articleCount" to runCatching { a.articleCount }.getOrDefault(0),
      "mediaCount" to runCatching { a.mediaCount }.getOrDefault(0),
      "mainPath" to h.mainPath,
      "hasFulltextIndex" to runCatching { a.hasFulltextIndex() }.getOrDefault(false),
      "hasTitleIndex" to runCatching { a.hasTitleIndex() }.getOrDefault(false),
      "illustration" to illustration,
    )
  }
}
