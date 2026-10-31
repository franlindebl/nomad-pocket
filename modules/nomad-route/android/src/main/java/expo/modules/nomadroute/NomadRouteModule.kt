package expo.modules.nomadroute

import android.system.Os
import com.valhalla.valhalla.Valhalla
import com.valhalla.valhalla.ValhallaException
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class RouterNotOpenException : CodedException("No routing pack is open")

/** "valhalla <code>: <message>", parsed by src/features/maps/routing.ts. */
class RoutingFailedException(message: String) : CodedException(message)

// valhalla-mobile reports engine errors as "ValhallaError(code=442, No path could be found…)".
private val ERROR = Regex("""ValhallaError\(code=(-?\d+), (.*)\)""", RegexOption.DOT_MATCHES_ALL)

private fun failure(e: Throwable): RoutingFailedException {
  val text = e.message ?: e.toString()
  val m = ERROR.find(text)
  return RoutingFailedException(if (m != null) "valhalla ${m.groupValues[1]}: ${m.groupValues[2]}" else "valhalla -1: $text")
}

class NomadRouteModule : Module() {
  private val context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  // A Valhalla actor is not safe to use from two threads: every call holds this lock.
  private val lock = Any()
  private var router: Valhalla? = null
  private var openConfig: String? = null
  private var openStamp: String? = null

  /**
   * Identity of the tile extract a config points at (inode, size, mtime), null when it
   * can't be read. The actor mmaps the extract: after a pack is replaced at the same path
   * it would keep routing on the old, unlinked file (and keep its blocks allocated).
   */
  private fun extractStamp(configJson: String): String? =
    runCatching {
      val path = JSONObject(configJson).getJSONObject("mjolnir").getString("tile_extract")
      val st = Os.stat(path)
      "${st.st_ino}:${st.st_size}:${st.st_mtime}"
    }.getOrNull()

  private fun <T> withRouter(action: (Valhalla) -> T): T =
    synchronized(lock) {
      val r = router ?: throw RouterNotOpenException()
      try {
        action(r)
      } catch (e: ValhallaException) {
        throw failure(e)
      } catch (e: IllegalStateException) {
        throw failure(e)
      }
    }

  override fun definition() = ModuleDefinition {
    Name("NomadRoute")

    // Reuses the open actor while the config and its tile extract file are the same: another
    // pack, or a pack file replaced at the same path (an update), rebuilds it.
    AsyncFunction("open") Coroutine { configJson: String ->
      withContext(Dispatchers.IO) {
        synchronized(lock) {
          val stamp = extractStamp(configJson)
          if (configJson == openConfig && stamp == openStamp && router != null) return@synchronized
          router?.close()
          router = null
          openConfig = null
          openStamp = null
          // valhalla-mobile builds its actor from a file; one fixed name, rewritten per pack.
          val file = File(context.cacheDir, "valhalla.json")
          file.writeText(configJson)
          try {
            router = Valhalla(file.absolutePath)
            openConfig = configJson
            openStamp = stamp
          } catch (e: Throwable) {
            throw failure(e)
          }
        }
      }
    }

    // Releases the actor and its mmap of the tile extract (call before deleting or replacing a
    // pack file, so its space is freed right away). Off the JS thread: a route on a cold
    // multi-GB pack can hold the lock for seconds.
    AsyncFunction("close") Coroutine { ->
      withContext(Dispatchers.IO) {
        synchronized(lock) {
          router?.close()
          router = null
          openConfig = null
          openStamp = null
        }
      }
    }

    AsyncFunction("route") Coroutine { request: String ->
      withContext(Dispatchers.IO) { withRouter { it.routeRaw(request) } }
    }

    AsyncFunction("matrix") Coroutine { request: String ->
      withContext(Dispatchers.IO) { withRouter { it.matrixRaw(request) } }
    }

    AsyncFunction("traceAttributes") Coroutine { request: String ->
      withContext(Dispatchers.IO) { withRouter { it.traceAttributesRaw(request) } }
    }
  }
}
