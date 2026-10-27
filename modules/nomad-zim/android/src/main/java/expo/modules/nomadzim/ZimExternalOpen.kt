package expo.modules.nomadzim

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File

/**
 * Android's WebView can't show a PDF (it stays blank): the entry is copied to the cache and
 * handed to the system's viewer instead. Only the last copy is kept; the cache folder is the
 * one res/xml/nomadzim_file_paths.xml shares.
 */
object ZimExternalOpen {
  private const val DIR = "zim-open"

  fun wants(mimeType: String): Boolean = mimeType.substringBefore(';').trim().equals("application/pdf", ignoreCase = true)

  /** Blocking (copies the file): call it off the main thread. False when the copy failed or no app can open it. */
  fun open(context: Context, activity: Activity?, h: ZimHandle, path: String): Boolean {
    val info = h.entryInfo(path) ?: return false
    val dir = File(context.cacheDir, DIR).apply {
      deleteRecursively()
      mkdirs()
    }
    val file = File(dir, info.path.substringAfterLast('/').ifEmpty { "document" })
    if (!h.writeTo(info.path, file)) return false
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.nomadzim.files", file)
    val intent = Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, ZimWebView.normalizedMime(info.mimeType, info.path))
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    if (activity == null) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return try {
      (activity ?: context).startActivity(intent)
      true
    } catch (_: ActivityNotFoundException) {
      false
    }
  }
}
