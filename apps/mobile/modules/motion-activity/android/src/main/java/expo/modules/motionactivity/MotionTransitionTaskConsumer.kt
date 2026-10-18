package expo.modules.motionactivity

import android.app.PendingIntent
import android.app.job.JobParameters
import android.app.job.JobService
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.PersistableBundle
import android.os.SystemClock
import android.util.Log
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity
import expo.modules.interfaces.taskManager.TaskConsumer
import expo.modules.interfaces.taskManager.TaskConsumerInterface
import expo.modules.interfaces.taskManager.TaskInterface
import expo.modules.interfaces.taskManager.TaskManagerUtilsInterface

/**
 * Subscribes to activity transitions and hands them to the JS task. Modelled
 * on expo-location's GeofencingTaskConsumer: the broadcast is turned into a
 * job so the JS runtime can be started for it when the app is not running,
 * and expo-task-manager re-registers the consumer after a reboot.
 */
class MotionTransitionTaskConsumer(context: Context, taskManagerUtils: TaskManagerUtilsInterface?) :
  TaskConsumer(context, taskManagerUtils), TaskConsumerInterface {
  private var task: TaskInterface? = null
  private var pendingIntent: PendingIntent? = null

  override fun taskType(): String = "motionActivity"

  override fun didRegister(task: TaskInterface) {
    this.task = task
    startTransitions()
  }

  override fun didUnregister() {
    stopTransitions()
    task = null
    pendingIntent = null
  }

  override fun setOptions(options: Map<String, Any>) {
    super.setOptions(options)
    stopTransitions()
    startTransitions()
  }

  override fun didReceiveBroadcast(intent: Intent) {
    val task = task ?: return
    val context = context ?: return
    if (!ActivityTransitionResult.hasResult(intent)) return
    val result = ActivityTransitionResult.extractResult(intent) ?: return

    // Event times are on the elapsed-realtime clock; convert to wall time.
    val bootTimeMs = System.currentTimeMillis() - SystemClock.elapsedRealtime()
    val events = result.transitionEvents.mapNotNull { event ->
      val activity = activityName(event.activityType) ?: return@mapNotNull null
      PersistableBundle().apply {
        putString("activity", activity)
        putString(
          "transition",
          if (event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER) "enter" else "exit"
        )
        putDouble("timestamp", (bootTimeMs + event.elapsedRealTimeNanos / 1_000_000).toDouble())
      }
    }
    if (events.isEmpty()) return

    taskManagerUtils.scheduleJob(context.applicationContext, task, events)
  }

  override fun didExecuteJob(jobService: JobService, params: JobParameters): Boolean {
    val task = task ?: return false

    val events = ArrayList<Bundle>()
    for (item in taskManagerUtils.extractDataFromJobParams(params)) {
      events.add(Bundle().apply { putAll(item) })
    }
    if (events.isEmpty()) return false

    val data = Bundle()
    data.putParcelableArrayList("events", events)
    task.execute(data, null) { jobService.jobFinished(params, false) }

    // Returning `true` indicates that the job is still running, but in async mode.
    return true
  }

  private fun startTransitions() {
    val context = context ?: run {
      Log.w(TAG, "The context has been abandoned")
      return
    }
    val task = task ?: return

    val transitions = TRACKED.flatMap { (activity, transitionTypes) ->
      transitionTypes.map { type ->
        ActivityTransition.Builder()
          .setActivityType(activity)
          .setActivityTransition(type)
          .build()
      }
    }

    val intent = taskManagerUtils.createTaskIntent(context, task)
    pendingIntent = intent
    try {
      ActivityRecognition.getClient(context)
        .requestActivityTransitionUpdates(ActivityTransitionRequest(transitions), intent)
        .addOnFailureListener { error -> Log.w(TAG, "Activity transition request failed", error) }
    } catch (error: SecurityException) {
      // ACTIVITY_RECOGNITION not granted — JS falls back to GPS-only detection.
      Log.w(TAG, "Activity transition request has been rejected.", error)
    }
  }

  private fun stopTransitions() {
    val context = context ?: return
    pendingIntent?.let { intent ->
      try {
        ActivityRecognition.getClient(context).removeActivityTransitionUpdates(intent)
      } catch (error: SecurityException) {
        Log.w(TAG, "Could not remove activity transition updates.", error)
      }
      intent.cancel()
    }
  }

  companion object {
    private const val TAG = "MotionTransitionConsumer"

    private val ENTER_EXIT = listOf(
      ActivityTransition.ACTIVITY_TRANSITION_ENTER,
      ActivityTransition.ACTIVITY_TRANSITION_EXIT
    )
    private val ENTER = listOf(ActivityTransition.ACTIVITY_TRANSITION_ENTER)

    /** Exits only matter for the vehicle; the rest just say what came next. */
    private val TRACKED = listOf(
      DetectedActivity.IN_VEHICLE to ENTER_EXIT,
      DetectedActivity.WALKING to ENTER,
      DetectedActivity.RUNNING to ENTER,
      DetectedActivity.ON_BICYCLE to ENTER,
      DetectedActivity.STILL to ENTER
    )

    private fun activityName(type: Int): String? = when (type) {
      DetectedActivity.IN_VEHICLE -> "automotive"
      DetectedActivity.WALKING -> "walking"
      DetectedActivity.RUNNING -> "running"
      DetectedActivity.ON_BICYCLE -> "cycling"
      DetectedActivity.STILL -> "stationary"
      else -> null
    }
  }
}
