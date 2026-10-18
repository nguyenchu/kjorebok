package expo.modules.carbluetooth

import android.app.job.JobParameters
import android.app.job.JobService
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.PersistableBundle
import expo.modules.interfaces.taskManager.TaskConsumer
import expo.modules.interfaces.taskManager.TaskConsumerInterface
import expo.modules.interfaces.taskManager.TaskInterface
import expo.modules.interfaces.taskManager.TaskManagerUtilsInterface

/**
 * Passes connection changes of the watched car devices to the JS task. The
 * address filter lives here, in the task options, so headphones and watches
 * never start the JS runtime.
 */
class CarBluetoothTaskConsumer(context: Context, taskManagerUtils: TaskManagerUtilsInterface?) :
  TaskConsumer(context, taskManagerUtils), TaskConsumerInterface {
  private var task: TaskInterface? = null

  override fun taskType(): String = "carBluetooth"

  override fun didRegister(task: TaskInterface) {
    this.task = task
  }

  override fun didUnregister() {
    task = null
  }

  override fun canReceiveCustomBroadcast(action: String?): Boolean =
    action == CarBluetoothReceiver.ACTION_CONNECTED || action == CarBluetoothReceiver.ACTION_DISCONNECTED

  override fun didReceiveBroadcast(intent: Intent) {
    val task = task ?: return
    val context = context ?: return
    val address = intent.getStringExtra(CarBluetoothReceiver.EXTRA_ADDRESS) ?: return
    if (!watchedAddresses(task).contains(address.uppercase())) return

    val event = PersistableBundle().apply {
      putString(
        "type",
        if (intent.action == CarBluetoothReceiver.ACTION_CONNECTED) "connected" else "disconnected"
      )
      putString("address", address.uppercase())
      putDouble(
        "timestamp",
        intent.getDoubleExtra(CarBluetoothReceiver.EXTRA_TIMESTAMP, System.currentTimeMillis().toDouble())
      )
    }
    taskManagerUtils.scheduleJob(context.applicationContext, task, listOf(event))
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

  private fun watchedAddresses(task: TaskInterface): Set<String> =
    (task.options["devices"] as? List<*>)
      ?.filterIsInstance<String>()
      ?.map { it.uppercase() }
      ?.toSet()
      ?: emptySet()
}
