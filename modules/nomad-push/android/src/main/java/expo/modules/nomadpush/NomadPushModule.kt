// JS API of the push module (Android only): FCM registration through the phone's own Play services with no Google
// code in the APK (FcmRegistrar.kt), and messages arriving while the app runs (PushReceiver.kt shows them anyway).
package expo.modules.nomadpush

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NomadPushModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NomadPush")
    Events("onMessage")

    OnCreate {
      PushEvents.listener = { id, latency -> sendEvent("onMessage", mapOf("messageId" to id, "latencyMs" to latency)) }
    }

    OnDestroy {
      PushEvents.listener = null
    }

    /** Play services' version code, or null when the phone has none (no FCM there). */
    Function("playServicesVersion") {
      FcmRegistrar(appContext.reactContext ?: throw CodedException("NO_CONTEXT", "No context", null)).playServicesVersion()
    }

    AsyncFunction("register") { projectId: String, projectNumber: String, appId: String, apiKey: String ->
      val context = appContext.reactContext ?: throw CodedException("NO_CONTEXT", "No context", null)
      try {
        val (token, fid, path) = FcmRegistrar(context).register(FcmConfig(projectId, projectNumber, appId, apiKey))
        mapOf("token" to token, "fid" to fid, "path" to path)
      } catch (e: Exception) {
        throw CodedException("REGISTER_FAILED", e.message ?: e.toString(), e)
      }
    }
  }
}
