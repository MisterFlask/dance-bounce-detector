package com.dancebounce.detector

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import kotlinx.coroutines.*
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

enum class AudioFeedbackMode {
    OFF, DISCRETE, FREQUENCY, FREQUENCY_FADEOUT
}

enum class GravityMode {
    SENSOR, FILTER
}

data class BounceDetectorConfig(
    var sensitivity: Float = 3.0f,        // Threshold for bounce detection (m/s^2)
    var debounceTime: Long = 300L,        // Minimum time between bounce detections (ms)
    var vibrationDuration: Long = 100L,   // How long to vibrate (ms)
    var audioMode: AudioFeedbackMode = AudioFeedbackMode.OFF,
    var audioVolume: Float = 0.5f,        // Audio volume (0.0 to 1.0)
    var audioSensitivity: Float = 5.0f,   // Max deviation for full pitch/volume response (m/s^2)
    var gravityMode: GravityMode = GravityMode.SENSOR
)

interface BounceDetectorListener {
    fun onBounceDetected(bounceCount: Int)
    fun onAccelerationUpdate(magnitude: Float)
    fun onStatusChanged(status: DetectionStatus, message: String)
    fun onCalibrationComplete(baseline: Float)
}

enum class DetectionStatus {
    READY, ACTIVE, CALIBRATING, ERROR, WARNING
}

class BounceDetector(private val context: Context) : SensorEventListener {

    var config = BounceDetectorConfig()
    var listener: BounceDetectorListener? = null

    private val sensorManager: SensorManager =
        context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val accelerometer: Sensor? =
        sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private val linearAccelerometer: Sensor? =
        sensorManager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
    private val gravitySensor: Sensor? =
        sensorManager.getDefaultSensor(Sensor.TYPE_GRAVITY)

    private val vibrator: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
        vibratorManager.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }

    private var isRunning = false
    private var isCalibrating = false
    private var lastBounceTime = 0L
    private var baselineMagnitude = 9.81f
    var bounceCount = 0
        private set

    // Gravity tracking with low-pass filter
    private var gravityX = 0f
    private var gravityY = 0f
    private var gravityZ = 9.81f
    private val gravityAlpha = 0.005f  // ~3 second time constant at 60Hz

    // Calibration samples
    private val calibrationSamples = mutableListOf<Float>()

    // Audio generation
    private var audioTrack: AudioTrack? = null
    private var audioJob: Job? = null
    private val audioScope = CoroutineScope(Dispatchers.Default)
    private var currentFrequency = 200f
    private var targetFrequency = 200f
    private var currentVolume = 0f
    private var targetVolume = 1f

    // Check if device supports gravity sensor
    val gravitySensorSupported: Boolean
        get() = gravitySensor != null && linearAccelerometer != null

    fun startDetection() {
        if (accelerometer == null) {
            listener?.onStatusChanged(DetectionStatus.ERROR, "Accelerometer not available")
            return
        }

        isRunning = true
        bounceCount = 0

        // Register accelerometer
        sensorManager.registerListener(
            this,
            accelerometer,
            SensorManager.SENSOR_DELAY_GAME
        )

        // Register gravity sensor if available and in sensor mode
        if (config.gravityMode == GravityMode.SENSOR && gravitySensorSupported) {
            sensorManager.registerListener(
                this,
                gravitySensor,
                SensorManager.SENSOR_DELAY_GAME
            )
            sensorManager.registerListener(
                this,
                linearAccelerometer,
                SensorManager.SENSOR_DELAY_GAME
            )
        }

        // Start frequency audio if in a frequency mode
        if (config.audioMode == AudioFeedbackMode.FREQUENCY ||
            config.audioMode == AudioFeedbackMode.FREQUENCY_FADEOUT) {
            startFrequencyAudio()
        }

        listener?.onStatusChanged(DetectionStatus.ACTIVE, "Detecting bounces...")
    }

    fun stopDetection() {
        isRunning = false
        sensorManager.unregisterListener(this)
        stopFrequencyAudio()
        listener?.onStatusChanged(DetectionStatus.READY, "Stopped")
    }

    fun startCalibration() {
        if (isRunning) {
            listener?.onStatusChanged(DetectionStatus.WARNING, "Stop detection before calibrating")
            return
        }

        isCalibrating = true
        calibrationSamples.clear()

        // Reset gravity for fast convergence during calibration
        gravityX = 0f
        gravityY = 0f
        gravityZ = 9.81f

        sensorManager.registerListener(
            this,
            accelerometer,
            SensorManager.SENSOR_DELAY_GAME
        )

        if (config.gravityMode == GravityMode.SENSOR && gravitySensorSupported) {
            sensorManager.registerListener(
                this,
                gravitySensor,
                SensorManager.SENSOR_DELAY_GAME
            )
        }

        listener?.onStatusChanged(DetectionStatus.CALIBRATING, "Calibrating... Hold phone still")
    }

    private fun finishCalibration() {
        sensorManager.unregisterListener(this)
        isCalibrating = false

        if (calibrationSamples.isNotEmpty()) {
            baselineMagnitude = calibrationSamples.average().toFloat()
            listener?.onCalibrationComplete(baselineMagnitude)
            listener?.onStatusChanged(
                DetectionStatus.READY,
                "Calibrated! Baseline: ${String.format("%.2f", baselineMagnitude)} m/s²"
            )
        }
    }

    // Sensor data storage for multi-sensor fusion
    private var lastGravity: FloatArray? = null
    private var lastLinearAcc: FloatArray? = null

    override fun onSensorChanged(event: SensorEvent) {
        when (event.sensor.type) {
            Sensor.TYPE_GRAVITY -> {
                lastGravity = event.values.clone()
                return // Don't process yet, wait for accelerometer
            }
            Sensor.TYPE_LINEAR_ACCELERATION -> {
                lastLinearAcc = event.values.clone()
                return // Don't process yet, wait for accelerometer
            }
            Sensor.TYPE_ACCELEROMETER -> {
                processAcceleration(event.values)
            }
        }
    }

    private fun processAcceleration(values: FloatArray) {
        val now = System.currentTimeMillis()
        val gx = values[0]
        val gy = values[1]
        val gz = values[2]

        // Determine which gravity estimation method to use
        val useSensor = config.gravityMode == GravityMode.SENSOR &&
                        gravitySensorSupported &&
                        lastGravity != null

        if (useSensor) {
            // Use device's gravity sensor directly
            gravityX = lastGravity!![0]
            gravityY = lastGravity!![1]
            gravityZ = lastGravity!![2]
        } else {
            // Use low-pass filter to estimate gravity
            val alpha = if (isCalibrating) 0.1f else gravityAlpha
            gravityX = alpha * gx + (1 - alpha) * gravityX
            gravityY = alpha * gy + (1 - alpha) * gravityY
            gravityZ = alpha * gz + (1 - alpha) * gravityZ
        }

        // Calculate gravity magnitude
        val gravityMagnitude = sqrt(
            gravityX * gravityX +
            gravityY * gravityY +
            gravityZ * gravityZ
        )

        val magnitude: Float

        if (useSensor && lastLinearAcc != null) {
            // Use linear acceleration if available
            val lx = lastLinearAcc!![0]
            val ly = lastLinearAcc!![1]
            val lz = lastLinearAcc!![2]

            if (gravityMagnitude > 0.1f) {
                // Project linear acceleration onto gravity direction
                val verticalLinearAcc = (lx * gravityX + ly * gravityY + lz * gravityZ) / gravityMagnitude
                magnitude = baselineMagnitude + verticalLinearAcc
            } else {
                magnitude = baselineMagnitude
            }
        } else {
            // Use accelerationIncludingGravity with projection
            if (gravityMagnitude > 0.1f) {
                val dotProduct = (gx * gravityX + gy * gravityY + gz * gravityZ) / gravityMagnitude
                magnitude = abs(dotProduct)
            } else {
                magnitude = sqrt(gx * gx + gy * gy + gz * gz)
            }
        }

        // Update UI with current acceleration
        listener?.onAccelerationUpdate(magnitude)

        // Handle calibration mode
        if (isCalibrating) {
            calibrationSamples.add(magnitude)
            if (calibrationSamples.size >= 50) {
                finishCalibration()
            }
            return
        }

        // Calculate deviation for frequency feedback
        val deviation = abs(magnitude - baselineMagnitude)

        // Update frequency audio feedback
        when (config.audioMode) {
            AudioFeedbackMode.FREQUENCY -> updateFrequencyFromDeviation(deviation)
            AudioFeedbackMode.FREQUENCY_FADEOUT -> updateFrequencyFadeoutFromDeviation(deviation)
            else -> {}
        }

        // Detect bounce
        if (detectBounce(magnitude, now)) {
            onBounceDetected()
        }
    }

    private fun detectBounce(currentMagnitude: Float, now: Long): Boolean {
        // Check debounce time
        if (now - lastBounceTime < config.debounceTime) {
            return false
        }

        // Calculate deviation from baseline
        val deviation = abs(currentMagnitude - baselineMagnitude)

        if (deviation > config.sensitivity) {
            lastBounceTime = now
            return true
        }

        return false
    }

    private fun onBounceDetected() {
        bounceCount++
        listener?.onBounceDetected(bounceCount)
        triggerFeedback()
    }

    private fun triggerFeedback() {
        // Vibration feedback
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(
                VibrationEffect.createOneShot(
                    config.vibrationDuration,
                    VibrationEffect.DEFAULT_AMPLITUDE
                )
            )
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(config.vibrationDuration)
        }

        // Discrete audio feedback
        if (config.audioMode == AudioFeedbackMode.DISCRETE) {
            playDiscreteBuzz()
        }
    }

    private fun playDiscreteBuzz() {
        audioScope.launch {
            val sampleRate = 44100
            val duration = 0.15f
            val numSamples = (sampleRate * duration).toInt()
            val buffer = ShortArray(numSamples)

            // Generate square wave at 440Hz
            val frequency = 440.0
            for (i in 0 until numSamples) {
                val t = i.toDouble() / sampleRate
                val envelope = if (i < numSamples * 0.1) i / (numSamples * 0.1f)
                              else 1f - (i - numSamples * 0.1f) / (numSamples * 0.9f)
                val sample = if (sin(2 * Math.PI * frequency * t) > 0) 1.0 else -1.0
                buffer[i] = (sample * Short.MAX_VALUE * config.audioVolume * envelope).toInt().toShort()
            }

            val track = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_GAME)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(sampleRate)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build()
                )
                .setBufferSizeInBytes(buffer.size * 2)
                .setTransferMode(AudioTrack.MODE_STATIC)
                .build()

            track.write(buffer, 0, buffer.size)
            track.play()
            delay((duration * 1000).toLong())
            track.release()
        }
    }

    private fun startFrequencyAudio() {
        stopFrequencyAudio()

        val sampleRate = 44100
        val bufferSize = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )

        audioTrack = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(bufferSize)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()

        audioTrack?.play()

        // Set initial volume based on mode
        currentVolume = if (config.audioMode == AudioFeedbackMode.FREQUENCY_FADEOUT) 0f else 1f
        targetVolume = currentVolume

        audioJob = audioScope.launch {
            val buffer = ShortArray(bufferSize / 2)
            var phase = 0.0

            while (isActive && isRunning) {
                // Smooth frequency transition
                currentFrequency += (targetFrequency - currentFrequency) * 0.1f

                // Smooth volume transition (faster rise, slower fall for fadeout)
                val volumeSmoothing = if (targetVolume > currentVolume) 0.3f else 0.05f
                currentVolume += (targetVolume - currentVolume) * volumeSmoothing

                for (i in buffer.indices) {
                    val sample = sin(phase) * currentVolume * config.audioVolume
                    buffer[i] = (sample * Short.MAX_VALUE).toInt().toShort()
                    phase += 2 * Math.PI * currentFrequency / sampleRate
                    if (phase > 2 * Math.PI) phase -= 2 * Math.PI
                }

                audioTrack?.write(buffer, 0, buffer.size)
            }
        }
    }

    private fun stopFrequencyAudio() {
        audioJob?.cancel()
        audioJob = null
        audioTrack?.stop()
        audioTrack?.release()
        audioTrack = null
    }

    private fun updateFrequencyFromDeviation(deviation: Float) {
        // Map deviation to frequency: 200Hz to 1000Hz
        val minFreq = 200f
        val maxFreq = 1000f
        val maxDeviation = config.audioSensitivity

        val normalizedDeviation = min(deviation / maxDeviation, 1f)
        targetFrequency = minFreq + (maxFreq - minFreq) * normalizedDeviation
        targetVolume = 1f
    }

    private fun updateFrequencyFadeoutFromDeviation(deviation: Float) {
        // Map deviation to frequency: 200Hz to 1000Hz
        val minFreq = 200f
        val maxFreq = 1000f
        val maxDeviation = config.audioSensitivity

        val normalizedDeviation = min(deviation / maxDeviation, 1f)
        targetFrequency = minFreq + (maxFreq - minFreq) * normalizedDeviation

        // Volume fades with deviation
        targetVolume = normalizedDeviation
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // Not used
    }

    fun release() {
        stopDetection()
        audioScope.cancel()
    }

    // Settings persistence
    fun getSettingsBundle(): Map<String, Any> {
        return mapOf(
            "sensitivity" to config.sensitivity,
            "baselineMagnitude" to baselineMagnitude,
            "audioMode" to config.audioMode.name,
            "audioVolume" to config.audioVolume,
            "audioSensitivity" to config.audioSensitivity,
            "gravityMode" to config.gravityMode.name,
            "gravityX" to gravityX,
            "gravityY" to gravityY,
            "gravityZ" to gravityZ
        )
    }

    fun loadSettings(settings: Map<String, Any>) {
        settings["sensitivity"]?.let { config.sensitivity = (it as Number).toFloat() }
        settings["baselineMagnitude"]?.let { baselineMagnitude = (it as Number).toFloat() }
        settings["audioMode"]?.let {
            config.audioMode = try {
                AudioFeedbackMode.valueOf(it as String)
            } catch (e: Exception) {
                AudioFeedbackMode.OFF
            }
        }
        settings["audioVolume"]?.let { config.audioVolume = (it as Number).toFloat() }
        settings["audioSensitivity"]?.let { config.audioSensitivity = (it as Number).toFloat() }
        settings["gravityMode"]?.let {
            config.gravityMode = try {
                GravityMode.valueOf(it as String)
            } catch (e: Exception) {
                GravityMode.SENSOR
            }
        }
        settings["gravityX"]?.let { gravityX = (it as Number).toFloat() }
        settings["gravityY"]?.let { gravityY = (it as Number).toFloat() }
        settings["gravityZ"]?.let { gravityZ = (it as Number).toFloat() }
    }
}
