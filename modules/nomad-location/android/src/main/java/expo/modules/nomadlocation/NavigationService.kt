// Keeps the app's process and its location updates alive while guidance runs with the app in the
// background or the screen off: a foreground service of type location, with the ongoing
// notification Android requires ("Navigating to …", a tap opens the app). It does no work itself;
// NomadLocationModule's navigation watch keeps receiving fixes because the service holds the
// process in the foreground state. Started from the foreground (the user set a target), which is
// what lets it use location with the while-in-use permission alone.
package expo.modules.nomadlocation

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.Manifest
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

private const val CHANNEL = "navigation"
private const val NOTIFICATION_ID = 7301
private const val EXTRA_TITLE = "title"
private const val EXTRA_BODY = "body"

class NavigationService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = notification(intent?.getStringExtra(EXTRA_TITLE) ?: "", intent?.getStringExtra(EXTRA_BODY) ?: "")
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      // Not allowed now (permission revoked, or started from the background): guidance goes on
      // while the app is in front, as before. A service started with startForegroundService must
      // still call startForeground once, or Android kills the app (ForegroundServiceDidNotStartInTime):
      // try it without the location type, then leave.
      Log.w("NomadLocation", "navigation service can't run in the foreground", e)
      try {
        startForeground(NOTIFICATION_ID, notification)
        stopForeground(STOP_FOREGROUND_REMOVE)
      } catch (again: Exception) {
        Log.w("NomadLocation", "navigation service can't start at all", again)
      }
      stopSelf()
    }
    // Killed with the app: guidance restarts from JS, not from a sticky service with no one to feed.
    return START_NOT_STICKY
  }

  private fun notification(title: String, body: String): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
      // The channel's name shows in the system settings; the title is already in the app language.
      manager.createNotificationChannel(NotificationChannel(CHANNEL, title, NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
    }
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    // expo-notifications' monochrome icon (app.json), else a system one.
    val icon = resources.getIdentifier("notification_icon", "drawable", packageName).takeIf { it != 0 } ?: android.R.drawable.ic_menu_mylocation
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this)
    return builder
      .setSmallIcon(icon)
      .setContentTitle(title)
      .setContentText(body)
      .setOngoing(true)
      .setCategory(Notification.CATEGORY_NAVIGATION)
      .apply { open?.let(::setContentIntent) }
      .build()
  }

  companion object {
    fun start(context: Context, title: String, body: String) {
      // Without location permission the typed service can't start: don't ask Android for one it will refuse.
      val granted = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        .any { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
      if (!granted) return
      val intent = Intent(context, NavigationService::class.java).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_BODY, body)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
      } catch (e: Exception) {
        // ForegroundServiceStartNotAllowedException (Android 12+, from the background): no service.
        Log.w("NomadLocation", "navigation service not started", e)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, NavigationService::class.java))
    }
  }
}
