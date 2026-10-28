package expo.modules.nomadzim

import android.content.Context
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException
import com.tom_roush.pdfbox.text.PDFTextStripper
import java.io.File
import java.util.UUID

/**
 * Text of a PDF stored in a ZIM archive (document collections: zimgit-*, military medicine),
 * for the library's document index. The entry is copied to a cache file (ZimHandle.writeTo
 * reads it a piece at a time) and PDFBox works from there with temp-file buffers, so a big
 * scan never sits in memory.
 */
object PdfText {
  fun extract(context: Context, handle: ZimHandle, path: String, maxPages: Int): Map<String, Any?>? {
    PDFBoxResourceLoader.init(context.applicationContext)
    val dir = File(context.cacheDir, "zim-pdf").apply { mkdirs() }
    val tmp = File(dir, "${UUID.randomUUID()}.pdf")
    try {
      if (!handle.writeTo(path, tmp)) return null
      val doc = try {
        PDDocument.load(tmp, "", MemoryUsageSetting.setupTempFileOnly().setTempDir(dir))
      } catch (e: InvalidPasswordException) {
        return mapOf("pages" to emptyList<String>(), "title" to null, "locked" to true)
      }
      doc.use {
        val count = minOf(doc.numberOfPages, maxPages)
        val stripper = PDFTextStripper()
        val pages = ArrayList<String>(count)
        for (page in 1..count) {
          stripper.startPage = page
          stripper.endPage = page
          // A page PDFBox can't parse costs that page, not the document.
          pages.add(runCatching { stripper.getText(doc) }.getOrDefault(""))
        }
        val title = runCatching { doc.documentInformation?.title }.getOrNull()?.trim()?.takeIf { it.isNotEmpty() }
        return mapOf("pages" to pages, "title" to title, "locked" to false, "pageCount" to doc.numberOfPages)
      }
    } catch (e: Throwable) {
      // Malformed files and certificate-encrypted ones (no Bouncy Castle): not indexable.
      return null
    } finally {
      tmp.delete()
    }
  }
}
