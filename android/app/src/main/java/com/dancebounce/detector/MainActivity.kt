package com.dancebounce.detector

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Colors matching the original web app
val BackgroundDark = Color(0xFF1a1a2e)
val BackgroundLight = Color(0xFF16213e)
val SurfaceColor = Color(0xFF1f2940)
val PrimaryColor = Color(0xFF6C63FF)
val BounceRed = Color(0xFFff4757)
val SuccessGreen = Color(0xFF2ecc71)
val WarningYellow = Color(0xFFf39c12)
val TextPrimary = Color(0xFFFFFFFF)
val TextSecondary = Color(0xFFb0b0b0)

class MainActivity : ComponentActivity(), BounceDetectorListener {

    private var bounceDetectorService: BounceDetectorService? = null
    private var serviceBound = false

    // UI State
    private val _isDetecting = mutableStateOf(false)
    private val _bounceCount = mutableStateOf(0)
    private val _currentAccel = mutableStateOf(0f)
    private val _statusMessage = mutableStateOf("Ready to start")
    private val _statusType = mutableStateOf(DetectionStatus.READY)
    private val _sensitivity = mutableStateOf(3.0f)
    private val _audioMode = mutableStateOf(AudioFeedbackMode.OFF)
    private val _audioVolume = mutableStateOf(0.5f)
    private val _gravityMode = mutableStateOf(GravityMode.SENSOR)
    private val _showBounce = mutableStateOf(false)
    private val _gravitySensorSupported = mutableStateOf(true)

    private lateinit var prefs: SharedPreferences

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as BounceDetectorService.LocalBinder
            bounceDetectorService = binder.getService().apply {
                serviceListener = this@MainActivity

                // Sync state from service
                _isDetecting.value = isDetecting
                _bounceCount.value = currentBounceCount

                // Apply saved settings to detector
                getDetector()?.let { detector ->
                    detector.config.sensitivity = _sensitivity.value
                    detector.config.audioMode = _audioMode.value
                    detector.config.audioVolume = _audioVolume.value
                    detector.config.gravityMode = _gravityMode.value
                    _gravitySensorSupported.value = detector.gravitySensorSupported
                }
            }
            serviceBound = true
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            bounceDetectorService = null
            serviceBound = false
        }
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            // Permission granted, can proceed
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        prefs = getSharedPreferences("bounce_detector_prefs", Context.MODE_PRIVATE)
        loadSettings()

        // Request notification permission on Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        setContent {
            BounceDetectorTheme {
                BounceDetectorScreen()
            }
        }
    }

    override fun onStart() {
        super.onStart()
        // Bind to service
        Intent(this, BounceDetectorService::class.java).also { intent ->
            bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
        }
    }

    override fun onStop() {
        super.onStop()
        if (serviceBound) {
            bounceDetectorService?.serviceListener = null
            unbindService(serviceConnection)
            serviceBound = false
        }
    }

    @Composable
    fun BounceDetectorTheme(content: @Composable () -> Unit) {
        MaterialTheme(
            colorScheme = darkColorScheme(
                primary = PrimaryColor,
                background = BackgroundDark,
                surface = SurfaceColor,
                onPrimary = TextPrimary,
                onBackground = TextPrimary,
                onSurface = TextPrimary
            ),
            content = content
        )
    }

    @Composable
    fun BounceDetectorScreen() {
        val isDetecting by _isDetecting
        val bounceCount by _bounceCount
        val currentAccel by _currentAccel
        val statusMessage by _statusMessage
        val statusType by _statusType
        val sensitivity by _sensitivity
        val audioMode by _audioMode
        val audioVolume by _audioVolume
        val gravityMode by _gravityMode
        val showBounce by _showBounce
        val gravitySensorSupported by _gravitySensorSupported
        val coroutineScope = rememberCoroutineScope()

        // Bounce indicator animation
        val bounceScale by animateFloatAsState(
            targetValue = if (showBounce) 1.1f else 1f,
            animationSpec = tween(100),
            label = "bounceScale"
        )
        val bounceColor by animateColorAsState(
            targetValue = if (showBounce) BounceRed else SurfaceColor,
            animationSpec = tween(100),
            label = "bounceColor"
        )

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    brush = Brush.verticalGradient(
                        colors = listOf(BackgroundDark, BackgroundLight)
                    )
                )
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp)
                    .verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Header
                Text(
                    text = "Dance Bounce Detector",
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary
                )
                Text(
                    text = "Eliminate habitual bouncing",
                    fontSize = 14.sp,
                    color = TextSecondary,
                    modifier = Modifier.padding(bottom = 24.dp)
                )

                // Bounce Indicator
                Box(
                    modifier = Modifier
                        .size(180.dp)
                        .scale(bounceScale)
                        .clip(CircleShape)
                        .background(bounceColor)
                        .border(
                            width = 4.dp,
                            color = if (isDetecting) PrimaryColor else TextSecondary,
                            shape = CircleShape
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = bounceCount.toString(),
                            fontSize = 48.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                        Text(
                            text = "bounces",
                            fontSize = 14.sp,
                            color = TextSecondary
                        )
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // Current Acceleration
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = SurfaceColor),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Vertical Acceleration:", color = TextSecondary)
                        Text(
                            text = String.format("%.2f m/s²", currentAccel),
                            color = TextPrimary,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Status
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = when (statusType) {
                            DetectionStatus.ACTIVE -> SuccessGreen.copy(alpha = 0.2f)
                            DetectionStatus.ERROR -> BounceRed.copy(alpha = 0.2f)
                            DetectionStatus.WARNING -> WarningYellow.copy(alpha = 0.2f)
                            DetectionStatus.CALIBRATING -> PrimaryColor.copy(alpha = 0.2f)
                            else -> SurfaceColor
                        }
                    ),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text(
                        text = statusMessage,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        textAlign = TextAlign.Center,
                        color = when (statusType) {
                            DetectionStatus.ACTIVE -> SuccessGreen
                            DetectionStatus.ERROR -> BounceRed
                            DetectionStatus.WARNING -> WarningYellow
                            DetectionStatus.CALIBRATING -> PrimaryColor
                            else -> TextSecondary
                        }
                    )
                }

                Spacer(modifier = Modifier.height(24.dp))

                // Control Buttons
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Button(
                        onClick = { toggleDetection() },
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isDetecting) BounceRed else PrimaryColor
                        ),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text(
                            text = if (isDetecting) "Stop Detection" else "Start Detection",
                            modifier = Modifier.padding(vertical = 8.dp)
                        )
                    }

                    Button(
                        onClick = { startCalibration() },
                        modifier = Modifier.weight(1f),
                        enabled = !isDetecting && statusType != DetectionStatus.CALIBRATING,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = SurfaceColor
                        ),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text(
                            text = "Calibrate",
                            modifier = Modifier.padding(vertical = 8.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                // Settings Section
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = SurfaceColor),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        // Sensitivity Slider
                        Text(
                            text = "Sensitivity: ${String.format("%.1f", sensitivity)} m/s²",
                            color = TextPrimary,
                            fontWeight = FontWeight.Medium
                        )
                        Slider(
                            value = sensitivity,
                            onValueChange = { value ->
                                _sensitivity.value = value
                                bounceDetectorService?.getDetector()?.config?.sensitivity = value
                                saveSettings()
                            },
                            valueRange = 1f..8f,
                            colors = SliderDefaults.colors(
                                thumbColor = PrimaryColor,
                                activeTrackColor = PrimaryColor
                            )
                        )

                        Spacer(modifier = Modifier.height(16.dp))

                        // Audio Mode
                        Text(
                            text = "Audio Feedback",
                            color = TextPrimary,
                            fontWeight = FontWeight.Medium
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        AudioModeSelector(
                            selectedMode = audioMode,
                            onModeSelected = { mode ->
                                _audioMode.value = mode
                                bounceDetectorService?.getDetector()?.config?.audioMode = mode
                                saveSettings()
                            }
                        )

                        // Audio Volume (only show if audio is enabled)
                        if (audioMode != AudioFeedbackMode.OFF) {
                            Spacer(modifier = Modifier.height(16.dp))
                            Text(
                                text = "Volume: ${(audioVolume * 100).toInt()}%",
                                color = TextPrimary,
                                fontWeight = FontWeight.Medium
                            )
                            Slider(
                                value = audioVolume,
                                onValueChange = { value ->
                                    _audioVolume.value = value
                                    bounceDetectorService?.getDetector()?.config?.audioVolume = value
                                    saveSettings()
                                },
                                valueRange = 0f..1f,
                                colors = SliderDefaults.colors(
                                    thumbColor = PrimaryColor,
                                    activeTrackColor = PrimaryColor
                                )
                            )
                        }

                        Spacer(modifier = Modifier.height(16.dp))

                        // Gravity Mode
                        Text(
                            text = "Gravity Detection",
                            color = TextPrimary,
                            fontWeight = FontWeight.Medium
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        GravityModeSelector(
                            selectedMode = gravityMode,
                            sensorSupported = gravitySensorSupported,
                            onModeSelected = { mode ->
                                _gravityMode.value = mode
                                bounceDetectorService?.getDetector()?.config?.gravityMode = mode
                                saveSettings()
                            }
                        )
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                // Instructions
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = SurfaceColor.copy(alpha = 0.5f)),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "How to Use",
                            color = TextPrimary,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(bottom = 8.dp)
                        )
                        InstructionItem("1. Hold phone still and tap Calibrate")
                        InstructionItem("2. Tap Start Detection")
                        InstructionItem("3. Dance! The app will buzz when you bounce")
                        InstructionItem("4. Works while phone is locked")
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))
            }
        }
    }

    @Composable
    fun AudioModeSelector(
        selectedMode: AudioFeedbackMode,
        onModeSelected: (AudioFeedbackMode) -> Unit
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            AudioFeedbackMode.values().forEach { mode ->
                FilterChip(
                    selected = selectedMode == mode,
                    onClick = { onModeSelected(mode) },
                    label = {
                        Text(
                            text = when (mode) {
                                AudioFeedbackMode.OFF -> "Off"
                                AudioFeedbackMode.DISCRETE -> "Buzz"
                                AudioFeedbackMode.FREQUENCY -> "Tone"
                                AudioFeedbackMode.FREQUENCY_FADEOUT -> "Fade"
                            },
                            fontSize = 12.sp
                        )
                    },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = PrimaryColor,
                        selectedLabelColor = TextPrimary
                    )
                )
            }
        }
    }

    @Composable
    fun GravityModeSelector(
        selectedMode: GravityMode,
        sensorSupported: Boolean,
        onModeSelected: (GravityMode) -> Unit
    ) {
        Column {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FilterChip(
                    selected = selectedMode == GravityMode.SENSOR,
                    onClick = { if (sensorSupported) onModeSelected(GravityMode.SENSOR) },
                    enabled = sensorSupported,
                    label = { Text("Sensor", fontSize = 12.sp) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = PrimaryColor,
                        selectedLabelColor = TextPrimary
                    )
                )
                FilterChip(
                    selected = selectedMode == GravityMode.FILTER,
                    onClick = { onModeSelected(GravityMode.FILTER) },
                    label = { Text("Filter", fontSize = 12.sp) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = PrimaryColor,
                        selectedLabelColor = TextPrimary
                    )
                )
            }
            Text(
                text = when {
                    selectedMode == GravityMode.SENSOR && sensorSupported ->
                        "Uses device's built-in sensor fusion"
                    selectedMode == GravityMode.SENSOR && !sensorSupported ->
                        "Sensor not available - using filter"
                    else -> "Uses software low-pass filter"
                },
                fontSize = 12.sp,
                color = TextSecondary,
                modifier = Modifier.padding(top = 4.dp)
            )
        }
    }

    @Composable
    fun InstructionItem(text: String) {
        Text(
            text = text,
            color = TextSecondary,
            fontSize = 14.sp,
            modifier = Modifier.padding(vertical = 2.dp)
        )
    }

    private fun toggleDetection() {
        if (_isDetecting.value) {
            bounceDetectorService?.stopDetection()
            _isDetecting.value = false
        } else {
            BounceDetectorService.startService(this)
            // Re-bind to get latest state
            if (!serviceBound) {
                Intent(this, BounceDetectorService::class.java).also { intent ->
                    bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
                }
            } else {
                bounceDetectorService?.startDetection()
            }
            _isDetecting.value = true
        }
    }

    private fun startCalibration() {
        bounceDetectorService?.startCalibration()
    }

    // BounceDetectorListener implementation
    override fun onBounceDetected(bounceCount: Int) {
        _bounceCount.value = bounceCount
        _showBounce.value = true

        // Reset bounce indicator after a short delay
        window.decorView.postDelayed({
            _showBounce.value = false
        }, 200)
    }

    override fun onAccelerationUpdate(magnitude: Float) {
        _currentAccel.value = magnitude
    }

    override fun onStatusChanged(status: DetectionStatus, message: String) {
        _statusType.value = status
        _statusMessage.value = message

        when (status) {
            DetectionStatus.ACTIVE -> _isDetecting.value = true
            DetectionStatus.READY -> {
                if (_isDetecting.value && message == "Stopped") {
                    _isDetecting.value = false
                }
            }
            else -> {}
        }
    }

    override fun onCalibrationComplete(baseline: Float) {
        saveSettings()
    }

    private fun saveSettings() {
        prefs.edit().apply {
            putFloat("sensitivity", _sensitivity.value)
            putString("audioMode", _audioMode.value.name)
            putFloat("audioVolume", _audioVolume.value)
            putString("gravityMode", _gravityMode.value.name)
            apply()
        }
    }

    private fun loadSettings() {
        _sensitivity.value = prefs.getFloat("sensitivity", 3.0f)
        _audioMode.value = try {
            AudioFeedbackMode.valueOf(prefs.getString("audioMode", "OFF") ?: "OFF")
        } catch (e: Exception) {
            AudioFeedbackMode.OFF
        }
        _audioVolume.value = prefs.getFloat("audioVolume", 0.5f)
        _gravityMode.value = try {
            GravityMode.valueOf(prefs.getString("gravityMode", "SENSOR") ?: "SENSOR")
        } catch (e: Exception) {
            GravityMode.SENSOR
        }
    }
}
