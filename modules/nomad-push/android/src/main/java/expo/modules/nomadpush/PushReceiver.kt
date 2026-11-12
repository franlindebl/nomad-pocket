// Receives FCM messages from the phone's Play services (the RECEIVE broadcast, which only the holder of the c2dm SEND
// signature permission can send) and shows them as a notification on the official alerts channel. Data-only
// messages: the server puts the visible text in `title` / `body`, so the app shows it the same way whether it is
// running, in the background or swiped away. Firebase acknowledges through its closed CloudMessagingReceiver when
// the manifest says FINISHED_AFTER_HANDLED; without that meta-data the legacy ordered broadcast's result code is
// the ack.
package expo.modules.nomadpush

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log

class PushReceiver : BroadcastReceiver() {
  companion object {
    const val CHANNEL = "alerts"
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (isOrderedBroadcast) resultCode = Activity.RESULT_OK
    val extras = intent.extras ?: return
    val type = extras.getString("message_type")
    if (type != null && type != "gcm") {
      Log.i(FcmRegistrar.TAG, "message_type $type")
      return
    }
    val sentAt = extras.getString("sentAt")?.toLongOrNull()
    val latency = sentAt?.let { System.currentTimeMillis() - it }
    Log.i(FcmRegistrar.TAG, "received ${extras.getString("google.message_id")} priority=${extras.getString("google.delivered_priority")} latencyMs=$latency")
    PushEvents.received(extras.getString("google.message_id"), latency)
    val title = extras.getString("title") ?: return
    val body = extras.getString("body") ?: ""
    show(context, title, body, extras.getString("key"))
  }

  private fun show(context: Context, title: String, body: String, key: String?) {
    val nm = context.getSystemService(NotificationManager::class.java)
    // The app creates the channel with its translated name when alerts are turned on; this is only a fallback.
    if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Avisos oficiales", NotificationManager.IMPORTANCE_HIGH))
    }
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      putExtra("nomadPushKind", "official-alert")
      key?.let { putExtra("nomadPushKey", it) }
    }
    val tap = launch?.let { PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
    val icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName).takeIf { it != 0 }
      ?: context.applicationInfo.icon
    val builder = if (Build.VERSION.SDK_INT >= 26) android.app.Notification.Builder(context, CHANNEL) else @Suppress("DEPRECATION") android.app.Notification.Builder(context)
    val notification = builder
      .setSmallIcon(icon)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(android.app.Notification.BigTextStyle().bigText(body))
      .setAutoCancel(true)
      .setCategory(android.app.Notification.CATEGORY_EVENT)
      .apply { tap?.let { setContentIntent(it) } }
      .build()
    nm.notify((key ?: SystemClock.elapsedRealtime().toString()).hashCode(), notification)
  }
}

/** Lets the module tell JS about messages received while it is running. */
object PushEvents {
  var listener: ((String?, Long?) -> Unit)? = null

  fun received(messageId: String?, latencyMs: Long?) = listener?.invoke(messageId, latencyMs)
}
