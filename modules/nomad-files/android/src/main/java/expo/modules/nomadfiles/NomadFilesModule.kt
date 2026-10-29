// Streaming file work for downloads that are gigabytes long: a sha-256 of a whole file, and
// copying one file into another at an offset (checking sha-1 pieces on the way). Same API as
// the iOS module (where expo-file-system's File.digest held the whole file in memory); here it
// keeps the bytes out of JS and reuses one buffer. Android only: raising the connections per
// host of expo-file-system's download client (raiseDownloadConcurrency).
package expo.modules.nomadfiles

import android.net.Uri
import android.util.Log
import expo.modules.filesystem.FileSystemDownloadTask
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.RandomAccessFile
import java.lang.reflect.Modifier
import java.security.MessageDigest
import okhttp3.OkHttpClient

private const val BLOCK = 4 * 1024 * 1024

/** Calls per host (and in all) expo-file-system's download client may run at once. */
private const val MAX_PER_HOST = 32
private const val MAX_CALLS = 128
/** OkHttp's default, what the client keeps when it can't be raised. */
private const val OKHTTP_PER_HOST = 5

/**
 * expo-file-system's DownloadTask runs every download through one OkHttpClient (a private static
 * field) whose dispatcher starts at most 5 calls per host: the rest wait in its queue and get no
 * byte. The segmented downloader opens up to 12 ranges to one URL (GitHub, Hugging Face, Kiwix's
 * load balancer when no mirror could be measured): the queued ones looked stalled after 15 s,
 * were cancelled as errors, and the download gave up with DOWNLOAD_STALLED (Mi 9, 2026-10-29).
 * Found by type, not by name: R8 renames the field in release builds. Returns the calls per host
 * the client now allows; the downloader keeps under it.
 */
private fun raiseDownloadConcurrency(): Int =
  try {
    val field = FileSystemDownloadTask::class.java.declaredFields.firstOrNull {
      Modifier.isStatic(it.modifiers) && OkHttpClient::class.java.isAssignableFrom(it.type)
    } ?: throw IllegalStateException("no OkHttpClient field")
    field.isAccessible = true
    val dispatcher = (field.get(null) as OkHttpClient).dispatcher
    dispatcher.maxRequests = maxOf(dispatcher.maxRequests, MAX_CALLS)
    dispatcher.maxRequestsPerHost = maxOf(dispatcher.maxRequestsPerHost, MAX_PER_HOST)
    dispatcher.maxRequestsPerHost
  } catch (e: Throwable) {
    Log.w("NomadFiles", "can't raise the download client's connections per host", e)
    OKHTTP_PER_HOST
  }

private fun fileOf(path: String): File = if (path.startsWith("file:")) File(Uri.parse(path).path!!) else File(path)

private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

/** Fills `buf` from `input` as far as it can; returns the bytes read (0 at the end). */
private fun readFully(input: FileInputStream, buf: ByteArray, size: Int): Int {
  var n = 0
  while (n < size) {
    val r = input.read(buf, n, size - n)
    if (r < 0) break
    n += r
  }
  return n
}

class NomadFilesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NomadFiles")

    Function("raiseDownloadConcurrency") { raiseDownloadConcurrency() }

    AsyncFunction("sha256") { path: String ->
      val digest = MessageDigest.getInstance("SHA-256")
      val buf = ByteArray(BLOCK)
      FileInputStream(fileOf(path)).use { input ->
        while (true) {
          val n = input.read(buf)
          if (n < 0) break
          digest.update(buf, 0, n)
        }
      }
      hex(digest.digest())
    }

    AsyncFunction("copyInto") { src: String, dst: String, offset: Double, pieceLength: Double, sha1s: List<String> ->
      val checked = sha1s.isNotEmpty() && pieceLength > 0
      val size = if (checked) pieceLength.toInt() else BLOCK
      val buf = ByteArray(size)
      val sha1 = MessageDigest.getInstance("SHA-1")
      var written = 0.0
      var piece = 0
      var bad = -1
      FileInputStream(fileOf(src)).use { input ->
        // "rw" creates the file when missing and never truncates it.
        RandomAccessFile(fileOf(dst), "rw").use { output ->
          output.seek(offset.toLong())
          while (true) {
            val n = readFully(input, buf, size)
            if (n == 0) break
            if (checked) {
              sha1.reset()
              sha1.update(buf, 0, n)
              if (piece >= sha1s.size || hex(sha1.digest()) != sha1s[piece].lowercase()) {
                bad = piece
                break
              }
              piece++
            }
            output.write(buf, 0, n)
            written += n
          }
        }
      }
      if (bad >= 0) -(bad + 1).toDouble() else written
    }
  }
}
