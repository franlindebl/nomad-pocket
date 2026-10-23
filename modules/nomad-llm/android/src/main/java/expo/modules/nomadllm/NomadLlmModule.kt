// System language model bridge for Android: Gemini Nano via the ML Kit GenAI
// Prompt API (AICore). Every failure degrades to a status the UI can explain.
package expo.modules.nomadllm

import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.GenAiException
import com.google.mlkit.genai.prompt.GenerateContentRequest
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.SystemInstruction
import com.google.mlkit.genai.prompt.TextPart
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class GenerateOptions : Record {
  @Field val prompt: String = ""
  @Field val system: String? = null
  @Field val temperature: Double? = null
  @Field val maxTokens: Int? = null
}

class NomadLlmModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private val jobs = ConcurrentHashMap<String, Job>()
  @Volatile private var client: GenerativeModel? = null

  private fun model(): GenerativeModel =
    client ?: synchronized(this) { client ?: Generation.getClient().also { client = it } }

  override fun definition() = ModuleDefinition {
    Name("NomadLlm")

    Events("onDelta", "onDone", "onError", "onDownloadProgress")

    AsyncFunction("getSystemModelStatus") Coroutine { -> status() }

    AsyncFunction("generate") { requestId: String, options: GenerateOptions, promise: Promise ->
      jobs[requestId] = scope.launch { runGeneration(requestId, options, promise) }
    }

    Function("cancel") { requestId: String ->
      jobs.remove(requestId)?.cancel()
    }

    AsyncFunction("downloadSystemModel") Coroutine { -> download() }

    OnDestroy {
      scope.cancel()
      runCatching { client?.close() }
      client = null
    }
  }

  private suspend fun status(): Map<String, Any?> {
    return try {
      when (val s = model().checkStatus()) {
        FeatureStatus.AVAILABLE -> mapOf("status" to "available", "provider" to "gemini")
        FeatureStatus.DOWNLOADABLE -> mapOf("status" to "downloadable", "provider" to "gemini")
        FeatureStatus.DOWNLOADING -> mapOf("status" to "modelNotReady", "provider" to "gemini")
        FeatureStatus.UNAVAILABLE -> mapOf("status" to "deviceNotEligible", "provider" to "gemini")
        else -> mapOf("status" to "unsupported", "provider" to "gemini", "detail" to "status $s")
      }
    } catch (e: Throwable) {
      // No AICore / Play services, unlocked bootloader, emulator...
      mapOf("status" to "unsupported", "provider" to null, "detail" to (e.message ?: e.toString()))
    }
  }

  private suspend fun download(): Boolean {
    var ok = false
    var total = 0L
    model().download().collect { st ->
      when (st) {
        is DownloadStatus.DownloadStarted -> {
          total = st.bytesToDownload
          sendEvent("onDownloadProgress", mapOf("bytesDownloaded" to 0L, "totalBytes" to total))
        }
        is DownloadStatus.DownloadProgress ->
          sendEvent("onDownloadProgress", mapOf("bytesDownloaded" to st.totalBytesDownloaded, "totalBytes" to total))
        is DownloadStatus.DownloadCompleted -> ok = true
        is DownloadStatus.DownloadFailed -> throw st.e
      }
    }
    return ok
  }

  private suspend fun runGeneration(requestId: String, options: GenerateOptions, promise: Promise) {
    val text = StringBuilder()
    try {
      val m = model()
      if (m.checkStatus() != FeatureStatus.AVAILABLE) {
        throw IllegalStateException("Gemini Nano is not available on this device")
      }
      val system = options.system
      val nativeSystem = system != null && runCatching { m.isSystemPromptAvailable() }.getOrDefault(false)
      val prompt = if (system != null && !nativeSystem) "$system\n\n${options.prompt}" else options.prompt
      val builder =
        if (nativeSystem) GenerateContentRequest.Builder(SystemInstruction(system!!), TextPart(prompt))
        else GenerateContentRequest.Builder(TextPart(prompt))
      options.temperature?.let { builder.temperature = it.toFloat() }
      options.maxTokens?.let { builder.maxOutputTokens = it }

      // Each streamed chunk carries the newly generated text.
      m.generateContentStream(builder.build()).collect { chunk ->
        val delta = chunk.candidates.firstOrNull()?.text.orEmpty()
        if (delta.isNotEmpty()) {
          text.append(delta)
          sendEvent("onDelta", mapOf("requestId" to requestId, "delta" to delta))
        }
      }
      sendEvent("onDone", mapOf("requestId" to requestId, "text" to text.toString(), "cancelled" to false))
      promise.resolve(text.toString())
    } catch (e: CancellationException) {
      sendEvent("onDone", mapOf("requestId" to requestId, "text" to text.toString(), "cancelled" to true))
      promise.resolve(text.toString())
    } catch (e: Throwable) {
      val code = if (e is GenAiException) "ERR_GENAI_${e.errorCode}" else "ERR_GENERATE"
      val message = e.message ?: e.toString()
      sendEvent("onError", mapOf("requestId" to requestId, "message" to message, "code" to code))
      promise.reject(code, message, e)
    } finally {
      jobs.remove(requestId)
    }
  }
}
