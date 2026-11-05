// Starting the app's JS from the car (CarPlayBoot.swift's twin). Opened from Android Auto or Android Automotive
// with the app not running, only the process starts: no activity, so React Native never loads and the app's
// startup (features/bootstrap, which the root layout runs) never happens: no styles, strings or lists for the car.
// The session starts a headless JS task instead ("NomadCar", src/features/carplay/headless.ts): it runs the
// startup without UI and lasts while the car is connected. It also keeps JS timers running with the phone's
// activity paused (React Native pauses them in the background unless a headless task is active), which the
// guidance and the lists need while the car's screen is in front.
package expo.modules.nomadcarplay

import android.content.Context
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

object CarJs {
  private const val TAG = "NomadCar"
  private const val TASK = "NomadCar"
  private var taskId: Int? = null
  private var context: ReactContext? = null
  private var wanted = false

  fun start(app: Context) {
    wanted = true
    val host = (app.applicationContext as? ReactApplication)?.reactHost
    if (host == null) {
      Log.w(TAG, "no React host: the car shows the map, without guidance")
      return
    }
    val ready = host.currentReactContext
    if (ready != null) {
      startTask(ready)
      return
    }
    host.addReactInstanceEventListener(
      object : ReactInstanceEventListener {
        override fun onReactContextInitialized(context: ReactContext) {
          host.removeReactInstanceEventListener(this)
          // startTask must run on the main thread; this callback may not.
          UiThreadUtil.runOnUiThread { if (wanted) startTask(context) }
        }
      },
    )
    host.start()
  }

  private fun startTask(ctx: ReactContext) {
    if (taskId != null) return
    try {
      // No timeout: the task ends when JS sees the car go (onDisconnect) or stop() below.
      taskId = HeadlessJsTaskContext.getInstance(ctx).startTask(HeadlessJsTaskConfig(TASK, Arguments.createMap(), 0, true))
      context = ctx
    } catch (e: Exception) {
      Log.w(TAG, "can't start the car's JS task", e)
    }
  }

  fun stop() {
    wanted = false
    val id = taskId ?: return
    val ctx = context
    taskId = null
    context = null
    ctx?.let {
      val tasks = HeadlessJsTaskContext.getInstance(it)
      if (tasks.isTaskRunning(id)) tasks.finishTask(id)
    }
  }
}
