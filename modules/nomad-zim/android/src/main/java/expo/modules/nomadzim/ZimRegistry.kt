package expo.modules.nomadzim

import android.content.Context
import org.kiwix.libkiwix.JNIKiwix
import org.kiwix.libzim.Archive
import org.kiwix.libzim.Query
import org.kiwix.libzim.Searcher
import org.kiwix.libzim.SuggestionSearcher
import java.io.RandomAccessFile
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

data class ZimEntryInfo(
  val path: String,
  val title: String,
  val mimeType: String,
  val size: Long,
  val wasRedirect: Boolean,
)

data class ZimHit(val path: String, val title: String, val snippet: String?, val wordCount: Int?)

/**
 * An open archive. libzim's Archive is safe for concurrent reads; searchers are
 * not, so they are created lazily and used under a lock.
 */
class ZimHandle(val id: String, val filePath: String, val archive: Archive) {
  // The reader's host name (https://<uuid>.zim.local): an item id is no valid fallback.
  val uuid: String =
    runCatching { archive.uuid.lowercase() }.getOrNull()?.takeIf { it.isNotEmpty() } ?: java.util.UUID.randomUUID().toString()
  private val suggestLock = Any()
  private val searchLock = Any()
  private var suggester: SuggestionSearcher? = null
  private var searcher: Searcher? = null

  fun metadata(name: String): String? = runCatching { archive.getMetadata(name) }.getOrNull()

  val mainPath: String?
    get() = runCatching {
      if (!archive.hasMainEntry()) null else archive.mainEntry.getItem(true).path
    }.getOrNull()

  fun entryInfo(path: String): ZimEntryInfo? = runCatching {
    val entry = archive.getEntryByPath(path)
    val redirect = entry.isRedirect
    val item = entry.getItem(true)
    ZimEntryInfo(item.path, item.title, item.mimetype, item.size, redirect)
  }.getOrNull()

  fun data(path: String): ByteArray? = runCatching {
    archive.getEntryByPath(path).getItem(true).data.data
  }.getOrNull()

  /** A byte range; uses direct file access for uncompressed items (media) when possible. */
  fun data(path: String, offset: Long, length: Long): ByteArray? = runCatching {
    val item = archive.getEntryByPath(path).getItem(true)
    val size = item.size
    if (offset >= size) return@runCatching ByteArray(0)
    val len = minOf(length, size - offset).toInt()
    val direct = runCatching { item.directAccessInformation }.getOrNull()
    if (direct != null && !direct.filename.isNullOrEmpty()) {
      RandomAccessFile(direct.filename, "r").use { file ->
        val buf = ByteArray(len)
        file.seek(direct.offset + offset)
        file.readFully(buf)
        buf
      }
    } else {
      val all = item.data.data
      all.copyOfRange(offset.toInt(), (offset + len).toInt())
    }
  }.getOrNull()

  fun illustrationPng(size: Int): ByteArray? = runCatching {
    if (!archive.hasIllustration(size)) null else archive.getIllustrationItem(size).data.data
  }.getOrNull()

  /** Copies an item to [out] (direct file reads for uncompressed items, so a big PDF never sits in memory). */
  fun writeTo(path: String, out: java.io.File): Boolean = runCatching {
    val item = archive.getEntryByPath(path).getItem(true)
    val direct = runCatching { item.directAccessInformation }.getOrNull()
    out.outputStream().use { os ->
      if (direct != null && !direct.filename.isNullOrEmpty()) {
        RandomAccessFile(direct.filename, "r").use { file ->
          file.seek(direct.offset)
          val buf = ByteArray(1 shl 20)
          var left = item.size
          while (left > 0) {
            val n = file.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
            if (n < 0) error("short read")
            os.write(buf, 0, n)
            left -= n
          }
        }
      } else {
        os.write(item.data.data)
      }
    }
    true
  }.getOrElse {
    out.delete()
    false
  }

  fun randomPath(): String? = runCatching { archive.randomEntry.getItem(true).path }.getOrNull()

  /** HTML articles in title order (redirects skipped), at most [limit]. */
  fun listArticles(limit: Int): List<ZimHit> {
    if (limit <= 0) return emptyList()
    val out = ArrayList<ZimHit>()
    runCatching {
      val it = archive.iterByTitle()
      try {
        while (it.hasNext() && out.size < limit) {
          val entry = it.next()
          if (entry.isRedirect) continue
          val item = entry.getItem(false)
          if (item.mimetype.startsWith("text/html")) out.add(ZimHit(item.path, item.title, null, null))
        }
      } finally {
        it.dispose()
      }
    }
    return out
  }

  fun suggest(query: String, limit: Int): List<ZimHit> {
    if (query.isEmpty() || limit <= 0) return emptyList()
    synchronized(suggestLock) {
      return runCatching {
        val s = suggester ?: SuggestionSearcher(archive).also { suggester = it }
        val search = s.suggest(query)
        val it = search.getResults(0, limit)
        val out = ArrayList<ZimHit>()
        while (it.hasNext()) {
          val item = it.next()
          out.add(ZimHit(item.path, item.title, if (item.hasSnippet()) item.snippet else null, null))
        }
        out
      }.getOrDefault(emptyList())
    }
  }

  fun search(query: String, limit: Int): List<ZimHit> {
    if (query.isEmpty() || limit <= 0 || !runCatching { archive.hasFulltextIndex() }.getOrDefault(false)) return emptyList()
    synchronized(searchLock) {
      return runCatching {
        val s = searcher ?: Searcher(archive).also { searcher = it }
        val search = s.search(Query(query))
        val it = search.getResults(0, limit)
        val out = ArrayList<ZimHit>()
        // The JNI iterator's getters describe the *next* item: read, then advance.
        while (it.hasNext()) {
          val path = it.path
          val title = it.title
          val snippet = runCatching { it.snippet }.getOrNull()
          val words = runCatching { it.wordCount }.getOrNull()
          out.add(ZimHit(path, title, snippet, words?.takeIf { w -> w >= 0 }))
          it.next()
        }
        out
      }.getOrDefault(emptyList())
    }
  }

  fun dispose() {
    synchronized(suggestLock) { runCatching { suggester?.dispose() }; suggester = null }
    synchronized(searchLock) { runCatching { searcher?.dispose() }; searcher = null }
    runCatching { archive.dispose() }
  }
}

/**
 * Process-wide open archives by item id, shared by module functions and ZimWebView. There
 * is no UUID index: two installed items can carry the same ZIM UUID (a re-import, or a
 * crafted file), so each reader serves only the archive of its own item id.
 */
object ZimRegistry {
  private val byId = ConcurrentHashMap<String, ZimHandle>()

  @Volatile
  private var jni: JNIKiwix? = null

  /** Loads the native libraries (libc++_shared, libkiwix, libzim and their JNI wrappers). */
  fun ensureLoaded(context: Context) {
    if (jni != null) return
    synchronized(this) {
      if (jni == null) jni = JNIKiwix(context.applicationContext)
    }
  }

  /**
   * WebView requests, media streams and IO coroutines may still be reading a handle
   * when it is closed; disposing it right away frees native memory under them (a
   * SIGSEGV runCatching can't catch). Dispose after a grace period instead.
   */
  private const val DISPOSE_DELAY_MS = 120_000L
  private val reaper = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "zim-reaper").apply { isDaemon = true } }

  private fun retire(handle: ZimHandle) {
    reaper.schedule({ handle.dispose() }, DISPOSE_DELAY_MS, TimeUnit.MILLISECONDS)
  }

  fun open(context: Context, id: String, path: String): ZimHandle {
    ensureLoaded(context)
    byId[id]?.let { if (it.filePath == path) return it }
    val handle = ZimHandle(id, path, Archive(path))
    byId.put(id, handle)?.let { old -> retire(old) }
    return handle
  }

  fun close(id: String) {
    byId.remove(id)?.let { retire(it) }
  }

  fun get(id: String): ZimHandle? = byId[id]
}
