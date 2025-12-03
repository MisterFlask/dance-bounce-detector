package com.dancebounce.detector

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

class BounceDetectorService : Service(), BounceDetectorListener {

    private val binder = LocalBinder()
    private var bounceDetector: BounceDetector? = null
    private var wakeLock: PowerManager.WakeLock? = null

    // Callback for activity to receive updates
    var serviceListener: BounceDetectorListener? = null

    // Current state
    var isDetecting = false
        private set
    var currentBounceCount = 0
        private set
    var currentAcceleration = 0f
        private set

    inner class LocalBinder : Binder() {
        fun getService(): BounceDetectorService = this@BounceDetectorService
    }

    override fun onBind(intent: Intent): IBinder {
        return binder
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        bounceDetector = BounceDetector(this).apply {
            listener = this@BounceDetectorService
        }

        // Acquire wake lock to keep CPU running when screen is off
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "DanceBounceDetector::DetectionWakeLock"
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START_DETECTION -> startDetection()
            ACTION_STOP_DETECTION -> stopDetection()
            ACTION_STOP_SERVICE -> {
                stopDetection()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.notification_channel_description)
                setShowBadge(false)
            }

            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun createNotification(bounceCount: Int): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, BounceDetectorService::class.java).apply {
                action = ACTION_STOP_DETECTION
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText("Bounces detected: $bounceCount")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .addAction(
                android.R.drawable.ic_media_pause,
                "Stop",
                stopIntent
            )
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    fun startDetection() {
        if (isDetecting) return

        // Start foreground service with notification
        startForeground(NOTIFICATION_ID, createNotification(0))

        // Acquire wake lock
        wakeLock?.acquire(4 * 60 * 60 * 1000L) // 4 hours max

        isDetecting = true
        currentBounceCount = 0
        bounceDetector?.startDetection()
    }

    fun stopDetection() {
        if (!isDetecting) return

        isDetecting = false
        bounceDetector?.stopDetection()

        // Release wake lock
        if (wakeLock?.isHeld == true) {
            wakeLock?.release()
        }

        // Update notification to show stopped state or remove
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    fun startCalibration() {
        bounceDetector?.startCalibration()
    }

    fun getDetector(): BounceDetector? = bounceDetector

    // BounceDetectorListener implementation
    override fun onBounceDetected(bounceCount: Int) {
        currentBounceCount = bounceCount

        // Update notification
        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.notify(NOTIFICATION_ID, createNotification(bounceCount))

        // Forward to activity
        serviceListener?.onBounceDetected(bounceCount)
    }

    override fun onAccelerationUpdate(magnitude: Float) {
        currentAcceleration = magnitude
        serviceListener?.onAccelerationUpdate(magnitude)
    }

    override fun onStatusChanged(status: DetectionStatus, message: String) {
        serviceListener?.onStatusChanged(status, message)
    }

    override fun onCalibrationComplete(baseline: Float) {
        serviceListener?.onCalibrationComplete(baseline)
    }

    override fun onDestroy() {
        stopDetection()
        bounceDetector?.release()
        super.onDestroy()
    }

    companion object {
        const val CHANNEL_ID = "bounce_detection_channel"
        const val NOTIFICATION_ID = 1
        const val ACTION_START_DETECTION = "com.dancebounce.detector.START"
        const val ACTION_STOP_DETECTION = "com.dancebounce.detector.STOP"
        const val ACTION_STOP_SERVICE = "com.dancebounce.detector.STOP_SERVICE"

        fun startService(context: Context) {
            val intent = Intent(context, BounceDetectorService::class.java).apply {
                action = ACTION_START_DETECTION
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stopService(context: Context) {
            val intent = Intent(context, BounceDetectorService::class.java).apply {
                action = ACTION_STOP_SERVICE
            }
            context.startService(intent)
        }
    }
}
