// FCM registration without Firebase or Play services code in the APK (docs/ALERTS_PLAN.md, "Android: FCM over IPC").
// Two steps, both written here from open sources:
// 1. A Firebase Installation (FID + auth token) over REST, like firebase-installations does.
// 2. A REGISTER request to the phone's own Play services app over intents/Messenger, with the extras of
//    firebase-messaging's GmsRpc.java (Apache 2.0) and the transport microG reimplements (CloudMessagingRpc,
//    InstanceIdRpc, Apache 2.0). Play services answers with the FCM registration token.
// The legacy startService path is tried first; if Play services doesn't answer, the bound-Messenger path newer
// Firebase versions use (the request as `data` in a Message with what=1).
package expo.modules.nomadpush

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Message
import android.os.Messenger
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

data class FcmConfig(val projectId: String, val projectNumber: String, val appId: String, val apiKey: String)

class FcmRegistrar(private val context: Context) {
  companion object {
    const val TAG = "NomadPush"
    const val GMS = "com.google.android.gms"
    private const val ACTION_REGISTER = "com.google.android.c2dm.intent.REGISTER"
    private const val ACTION_REGISTRATION = "com.google.android.c2dm.intent.REGISTRATION"
    private const val PREFS = "nomad-push"
    // Mirrors a current firebase-messaging; Play services may look at it.
    private const val CLIENT_VERSION = "fcm-24.1.2"
    private const val FIS_SDK = "a:18.0.0"
    private val requestIds = AtomicInteger(1)
  }

  private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun playServicesVersion(): Int? =
    try {
      val info = context.packageManager.getPackageInfo(GMS, 0)
      if (Build.VERSION.SDK_INT >= 28) info.longVersionCode.toInt() else @Suppress("DEPRECATION") info.versionCode
    } catch (_: PackageManager.NameNotFoundException) {
      null
    }

  /** Blocking: call off the main thread. Returns [token, fid, path]. */
  fun register(config: FcmConfig): List<String> {
    val gmsVersion = playServicesVersion() ?: throw IOException("NO_PLAY_SERVICES")
    val (fid, authToken) = installation(config)
    val extras = Bundle().apply {
      putString("scope", "*")
      putString("sender", config.projectNumber)
      putString("subtype", config.projectNumber)
      putString("gmp_app_id", config.appId)
      putString("gmsv", gmsVersion.toString())
      putString("osv", Build.VERSION.SDK_INT.toString())
      putString("app_ver", appVersionCode().toString())
      putString("app_ver_name", appVersionName())
      putString("firebase-app-name-hash", b64(MessageDigest.getInstance("SHA-1").digest("[DEFAULT]".toByteArray())))
      putString("Goog-Api-Key", config.apiKey)
      putString("Goog-Firebase-Installations-Auth", authToken)
      putString("appid", fid)
      putString("cliv", CLIENT_VERSION)
    }
    val legacy = try {
      registerViaIntent(Bundle(extras))
    } catch (e: IOException) {
      Log.w(TAG, "intent path: ${e.message}")
      null
    }
    val (reply, path) = legacy?.let { it to "intent" } ?: (registerViaBoundMessenger(Bundle(extras)) to "bound")
    @Suppress("DEPRECATION")
    Log.i(TAG, "reply via $path: " + reply.keySet().joinToString { k -> "$k=" + reply.get(k).toString().let { v -> if (v.length > 40) v.take(24) + "…(" + v.length + ")" else v } })
    val raw = reply.getString("registration_id")
      ?: throw IOException(reply.getString("error") ?: reply.getString("unregistered")?.let { "UNREGISTERED" } ?: "NO_TOKEN ${reply.keySet()}")
    // Replies carry the request id in front: "|ID|<kid>|:<token>" (firebase's Rpc strips it the same way).
    val token = raw.replace(Regex("^\\|ID\\|[^|]*\\|:?"), "")
    if (token.isEmpty() || token == "MESSENGER") throw IOException("NO_TOKEN $raw")
    prefs.edit().putString("token", token).apply()
    return listOf(token, fid, path)
  }

  // --- Firebase Installations (REST) ---

  private fun installation(config: FcmConfig): Pair<String, String> {
    val fid = prefs.getString("fid", null)
    val refresh = prefs.getString("fisRefresh", null)
    if (fid != null && refresh != null) {
      try {
        val res = post(
          "https://firebaseinstallations.googleapis.com/v1/projects/${config.projectId}/installations/$fid/authTokens:generate",
          config,
          JSONObject().put("installation", JSONObject().put("sdkVersion", FIS_SDK)),
          mapOf("Authorization" to "FIS_v2 $refresh"),
        )
        return fid to res.getString("token")
      } catch (e: IOException) {
        Log.w(TAG, "FIS refresh failed, creating a new installation: ${e.message}")
      }
    }
    val res = post(
      "https://firebaseinstallations.googleapis.com/v1/projects/${config.projectId}/installations",
      config,
      JSONObject().put("fid", newFid()).put("appId", config.appId).put("authVersion", "FIS_v2").put("sdkVersion", FIS_SDK),
      emptyMap(),
    )
    val newFid = res.getString("fid")
    prefs.edit().putString("fid", newFid).putString("fisRefresh", res.getString("refreshToken")).apply()
    return newFid to res.getJSONObject("authToken").getString("token")
  }

  private fun post(url: String, config: FcmConfig, body: JSONObject, headers: Map<String, String>): JSONObject {
    val conn = URL(url).openConnection() as HttpURLConnection
    conn.requestMethod = "POST"
    conn.connectTimeout = 15_000
    conn.readTimeout = 15_000
    conn.doOutput = true
    conn.setRequestProperty("Content-Type", "application/json")
    conn.setRequestProperty("Accept", "application/json")
    conn.setRequestProperty("x-goog-api-key", config.apiKey)
    // Needed when the API key is restricted to Android apps.
    conn.setRequestProperty("X-Android-Package", context.packageName)
    signingCertSha1()?.let { conn.setRequestProperty("X-Android-Cert", it) }
    headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
    conn.outputStream.use { it.write(body.toString().toByteArray()) }
    val code = conn.responseCode
    val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
    if (code !in 200..299) throw IOException("FIS HTTP $code ${text.take(300)}")
    return JSONObject(text)
  }

  /** 22 characters of base64url over 17 random bytes whose first four bits are 0111 (firebase-installations' FID). */
  private fun newFid(): String {
    val bytes = ByteArray(17).also { SecureRandom().nextBytes(it) }
    bytes[0] = ((bytes[0].toInt() and 0x0f) or 0x70).toByte()
    return b64(bytes).substring(0, 22)
  }

  // --- Play services: legacy intent + reply Messenger ---

  private fun registerViaIntent(extras: Bundle): Bundle {
    val replies = LinkedBlockingQueue<Bundle>()
    val thread = HandlerThread("nomad-push-rpc").apply { start() }
    try {
      val messenger = Messenger(object : Handler(thread.looper) {
        override fun handleMessage(msg: Message) {
          val intent = msg.obj as? Intent ?: return
          if (intent.action == ACTION_REGISTRATION) replies.add(intent.extras ?: Bundle())
        }
      })
      fun request(): Intent {
        val id = requestIds.getAndIncrement()
        return Intent(ACTION_REGISTER).setPackage(GMS).putExtras(extras).apply {
          putExtra("app", appToken())
          putExtra("kid", "|ID|$id|")
          putExtra("X-kid", "|ID|$id|")
          putExtra("google.messenger", messenger)
        }
      }
      context.startService(request()) ?: throw IOException("REGISTER service not found")
      val first = replies.poll(20, TimeUnit.SECONDS) ?: throw IOException("TIMEOUT")
      // The first answer can be a handshake: registration_id "|ID|n|:MESSENGER" plus Play services' own Messenger,
      // through which the request must be sent again (microG's sendRegisterMessageBlocking does the same).
      @Suppress("DEPRECATION")
      val gmsMessenger = first.getParcelable<Messenger>("google.messenger")
      if (gmsMessenger == null && first.getString("registration_id")?.endsWith(":MESSENGER") != true) return first
      gmsMessenger ?: throw IOException("MESSENGER handshake without a Messenger")
      Log.i(TAG, "Play services handshake, sending again through its Messenger")
      gmsMessenger.send(Message.obtain().apply { obj = request() })
      return replies.poll(20, TimeUnit.SECONDS) ?: throw IOException("TIMEOUT (messenger)")
    } finally {
      thread.quitSafely()
    }
  }

  // --- Play services: bound Messenger (what=1, request in data) ---

  private fun registerViaBoundMessenger(extras: Bundle): Bundle {
    val replies = LinkedBlockingQueue<Bundle>()
    val thread = HandlerThread("nomad-push-ipc").apply { start() }
    val id = requestIds.getAndIncrement()
    val reply = Messenger(object : Handler(thread.looper) {
      override fun handleMessage(msg: Message) {
        if (msg.arg1 != id) return
        val data = msg.data ?: Bundle()
        replies.add(if (data.getBoolean("unsupported", false)) Bundle().apply { putString("error", "UNSUPPORTED") } else data.getBundle("data") ?: data)
      }
    })
    val connected = LinkedBlockingQueue<IBinder>()
    val conn = object : ServiceConnection {
      override fun onServiceConnected(name: ComponentName, service: IBinder) {
        connected.add(service)
      }

      override fun onServiceDisconnected(name: ComponentName) {}
    }
    try {
      if (!context.bindService(Intent(ACTION_REGISTER).setPackage(GMS), conn, Context.BIND_AUTO_CREATE)) {
        throw IOException("BIND_FAILED")
      }
      val binder = connected.poll(10, TimeUnit.SECONDS) ?: throw IOException("BIND_TIMEOUT")
      Log.i(TAG, "bound to Play services, interface ${binder.interfaceDescriptor}")
      val msg = Message.obtain().apply {
        what = 1
        arg1 = id
        replyTo = reply
        data = Bundle().apply {
          putBoolean("oneWay", false)
          putString("pkg", context.packageName)
          putBundle("data", extras.apply { putParcelable("app", appToken()) })
        }
      }
      Messenger(binder).send(msg)
      return replies.poll(20, TimeUnit.SECONDS) ?: throw IOException("TIMEOUT (bound)")
    } finally {
      try {
        context.unbindService(conn)
      } catch (_: IllegalArgumentException) {}
      thread.quitSafely()
    }
  }

  /** A PendingIntent only this app can create: Play services reads the caller's package from it. */
  private fun appToken(): PendingIntent =
    PendingIntent.getBroadcast(context, 0, Intent().setPackage("com.google.example.invalidpackage"), PendingIntent.FLAG_IMMUTABLE)

  // --- helpers ---

  private fun appVersionCode(): Long {
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
  }

  private fun appVersionName(): String = context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: ""

  private fun signingCertSha1(): String? =
    try {
      val sig = if (Build.VERSION.SDK_INT >= 28) {
        context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners?.firstOrNull()
      } else {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES).signatures?.firstOrNull()
      }
      sig?.let { MessageDigest.getInstance("SHA-1").digest(it.toByteArray()).joinToString("") { b -> "%02X".format(b) } }
    } catch (_: Exception) {
      null
    }

  private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
}
