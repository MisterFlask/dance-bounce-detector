/**
 * Dance Bounce Detector
 * Detects vertical bouncing using the smartphone accelerometer
 * and provides haptic feedback to help dancers avoid habitual bouncing.
 */
class BounceDetector {
    constructor(config = {}) {
        this.isRunning = false;
        this.lastBounceTime = 0;
        this.samples = [];
        this.baselineZ = 9.81; // Earth's gravity
        this.calibrationSamples = [];
        this.isCalibrating = false;
        // Audio properties
        this.audioContext = null;
        this.oscillator = null;
        this.gainNode = null;
        this.isAudioInitialized = false;
        // UI Elements
        this.statusEl = null;
        this.indicatorEl = null;
        this.sensitivitySlider = null;
        this.sensitivityValue = null;
        this.startBtn = null;
        this.calibrateBtn = null;
        this.bounceCountEl = null;
        this.currentAccelEl = null;
        this.audioModeSelect = null;
        this.audioVolumeSlider = null;
        this.audioVolumeValue = null;
        this.bounceCount = 0;
        this.permissionGranted = false;
        this.handleMotion = (event) => {
            const acceleration = event.accelerationIncludingGravity;
            if (!acceleration || acceleration.z === null) {
                return;
            }
            const now = Date.now();
            const z = acceleration.z;
            // Update current acceleration display
            if (this.currentAccelEl) {
                this.currentAccelEl.textContent = z.toFixed(2);
            }
            // Handle calibration mode
            if (this.isCalibrating) {
                this.calibrationSamples.push(z);
                if (this.calibrationSamples.length >= 50) {
                    this.finishCalibration();
                }
                return;
            }
            // Calculate deviation for frequency feedback
            const deviation = Math.abs(z - this.baselineZ);
            // Update frequency audio feedback (continuous)
            if (this.config.audioMode === 'frequency') {
                this.updateFrequencyFromDeviation(deviation);
            }
            // Add sample to buffer
            this.samples.push({ timestamp: now, z });
            // Keep only recent samples
            while (this.samples.length > this.config.sampleWindow) {
                this.samples.shift();
            }
            // Detect bounce
            if (this.detectBounce(z, now)) {
                this.onBounceDetected();
            }
        };
        this.config = {
            sensitivity: 3.0, // Default threshold in m/s^2 above/below gravity
            debounceTime: 300, // 300ms between detections
            vibrationDuration: 100, // 100ms vibration
            sampleWindow: 10, // Analyze last 10 samples
            audioMode: 'off', // Audio feedback off by default
            audioVolume: 0.5, // 50% volume by default
            ...config
        };
    }
    init() {
        this.bindUIElements();
        this.setupEventListeners();
        this.checkDeviceSupport();
        this.loadSettings();
    }
    bindUIElements() {
        this.statusEl = document.getElementById('status');
        this.indicatorEl = document.getElementById('bounce-indicator');
        this.sensitivitySlider = document.getElementById('sensitivity');
        this.sensitivityValue = document.getElementById('sensitivity-value');
        this.startBtn = document.getElementById('start-btn');
        this.calibrateBtn = document.getElementById('calibrate-btn');
        this.bounceCountEl = document.getElementById('bounce-count');
        this.currentAccelEl = document.getElementById('current-accel');
        this.audioModeSelect = document.getElementById('audio-mode');
        this.audioVolumeSlider = document.getElementById('audio-volume');
        this.audioVolumeValue = document.getElementById('audio-volume-value');
    }
    setupEventListeners() {
        this.startBtn?.addEventListener('click', () => this.toggleDetection());
        this.calibrateBtn?.addEventListener('click', () => this.startCalibration());
        this.sensitivitySlider?.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.config.sensitivity = value;
            if (this.sensitivityValue) {
                this.sensitivityValue.textContent = value.toFixed(1);
            }
            this.saveSettings();
        });
        this.audioModeSelect?.addEventListener('change', (e) => {
            const mode = e.target.value;
            this.config.audioMode = mode;
            this.handleAudioModeChange();
            this.saveSettings();
        });
        this.audioVolumeSlider?.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.config.audioVolume = value;
            if (this.audioVolumeValue) {
                this.audioVolumeValue.textContent = Math.round(value * 100).toString();
            }
            if (this.gainNode) {
                this.gainNode.gain.value = value;
            }
            this.saveSettings();
        });
    }
    checkDeviceSupport() {
        const hasAccelerometer = 'DeviceMotionEvent' in window;
        const hasVibration = 'vibrate' in navigator;
        if (!hasAccelerometer) {
            this.updateStatus('Accelerometer not supported on this device', 'error');
            if (this.startBtn)
                this.startBtn.disabled = true;
            return;
        }
        if (!hasVibration) {
            this.updateStatus('Vibration not supported - visual feedback only', 'warning');
        }
        this.updateStatus('Ready to start', 'ready');
    }
    async requestPermission() {
        // iOS 13+ requires permission request
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            try {
                const permission = await DeviceMotionEvent.requestPermission();
                if (permission === 'granted') {
                    this.permissionGranted = true;
                    return true;
                }
                else {
                    this.updateStatus('Permission denied. Please allow motion access.', 'error');
                    return false;
                }
            }
            catch (error) {
                this.updateStatus('Error requesting permission', 'error');
                console.error('Permission error:', error);
                return false;
            }
        }
        // Android and older iOS don't need explicit permission
        this.permissionGranted = true;
        return true;
    }
    async toggleDetection() {
        if (this.isRunning) {
            this.stopDetection();
        }
        else {
            await this.startDetection();
        }
    }
    async startDetection() {
        if (!this.permissionGranted) {
            const granted = await this.requestPermission();
            if (!granted)
                return;
        }
        // Initialize and resume audio context during user gesture
        // This is critical for browser autoplay policies
        if (this.config.audioMode !== 'off') {
            this.initAudio();
            if (this.audioContext && this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
        }
        this.isRunning = true;
        this.bounceCount = 0;
        this.updateBounceCount();
        window.addEventListener('devicemotion', this.handleMotion);
        // Start frequency audio if in frequency mode
        if (this.config.audioMode === 'frequency') {
            await this.startFrequencyAudio();
        }
        if (this.startBtn) {
            this.startBtn.textContent = 'Stop Detection';
            this.startBtn.classList.add('active');
        }
        this.updateStatus('Detecting bounces...', 'active');
    }
    stopDetection() {
        this.isRunning = false;
        window.removeEventListener('devicemotion', this.handleMotion);
        // Stop frequency audio
        this.stopFrequencyAudio();
        if (this.startBtn) {
            this.startBtn.textContent = 'Start Detection';
            this.startBtn.classList.remove('active');
        }
        this.updateStatus('Stopped', 'ready');
        this.clearBounceIndicator();
    }
    detectBounce(currentZ, now) {
        // Check debounce time
        if (now - this.lastBounceTime < this.config.debounceTime) {
            return false;
        }
        // Calculate deviation from baseline (gravity)
        const deviation = Math.abs(currentZ - this.baselineZ);
        // A bounce creates acceleration significantly different from gravity
        // When moving up: z < gravity (feeling lighter)
        // When moving down: z > gravity (feeling heavier)
        if (deviation > this.config.sensitivity) {
            this.lastBounceTime = now;
            return true;
        }
        return false;
    }
    onBounceDetected() {
        this.bounceCount++;
        this.updateBounceCount();
        this.triggerFeedback();
        this.showBounceIndicator();
    }
    triggerFeedback() {
        // Vibration feedback
        if ('vibrate' in navigator) {
            navigator.vibrate(this.config.vibrationDuration);
        }
        // Discrete audio feedback (buzz on bounce detection)
        if (this.config.audioMode === 'discrete') {
            this.playDiscreteBuzz();
        }
    }
    initAudio() {
        if (this.isAudioInitialized)
            return;
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.gainNode = this.audioContext.createGain();
            this.gainNode.connect(this.audioContext.destination);
            this.gainNode.gain.value = this.config.audioVolume;
            this.isAudioInitialized = true;
        }
        catch (e) {
            console.warn('Web Audio API not supported:', e);
        }
    }
    async handleAudioModeChange() {
        if (this.config.audioMode !== 'off' && !this.isAudioInitialized) {
            this.initAudio();
            // Resume audio context during user gesture (dropdown change)
            if (this.audioContext && this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
        }
        // Stop frequency audio if switching away from frequency mode
        if (this.config.audioMode !== 'frequency') {
            this.stopFrequencyAudio();
        }
        // Start frequency audio if switching to frequency mode and detection is running
        if (this.config.audioMode === 'frequency' && this.isRunning) {
            await this.startFrequencyAudio();
        }
    }
    async startFrequencyAudio() {
        if (!this.audioContext || !this.gainNode) {
            this.initAudio();
        }
        if (!this.audioContext || !this.gainNode)
            return;
        // Resume audio context if suspended (needed for browsers with autoplay policies)
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        // Stop existing oscillator if any
        this.stopFrequencyAudio();
        // Create oscillator for continuous frequency feedback
        this.oscillator = this.audioContext.createOscillator();
        this.oscillator.type = 'sine';
        this.oscillator.frequency.value = 200; // Base frequency in Hz
        this.oscillator.connect(this.gainNode);
        this.oscillator.start();
    }
    stopFrequencyAudio() {
        if (this.oscillator) {
            try {
                this.oscillator.stop();
                this.oscillator.disconnect();
            }
            catch (e) {
                // Oscillator might already be stopped
            }
            this.oscillator = null;
        }
    }
    updateFrequencyFromDeviation(deviation) {
        if (!this.oscillator || this.config.audioMode !== 'frequency')
            return;
        // Map deviation to frequency:
        // - 0 deviation = 200 Hz (low, calm)
        // - max deviation (e.g., 10 m/s²) = 1000 Hz (high, alert)
        // Using a non-linear mapping for better perception
        const minFreq = 200;
        const maxFreq = 1000;
        const maxDeviation = 10; // Maximum expected deviation in m/s²
        const normalizedDeviation = Math.min(deviation / maxDeviation, 1);
        const frequency = minFreq + (maxFreq - minFreq) * normalizedDeviation;
        // Smooth frequency transition
        this.oscillator.frequency.setTargetAtTime(frequency, this.audioContext.currentTime, 0.05 // Time constant for smooth transition
        );
    }
    async playDiscreteBuzz() {
        if (!this.audioContext || !this.gainNode) {
            this.initAudio();
        }
        if (!this.audioContext || !this.gainNode)
            return;
        // Resume audio context if suspended
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        // Create a short buzz sound
        const buzzOscillator = this.audioContext.createOscillator();
        const buzzGain = this.audioContext.createGain();
        buzzOscillator.type = 'square';
        buzzOscillator.frequency.value = 440; // A4 note
        buzzGain.gain.value = this.config.audioVolume;
        buzzGain.gain.setTargetAtTime(0, this.audioContext.currentTime + 0.1, 0.02);
        buzzOscillator.connect(buzzGain);
        buzzGain.connect(this.audioContext.destination);
        buzzOscillator.start();
        buzzOscillator.stop(this.audioContext.currentTime + 0.15);
    }
    showBounceIndicator() {
        if (this.indicatorEl) {
            this.indicatorEl.classList.add('bounce');
            setTimeout(() => this.clearBounceIndicator(), 200);
        }
    }
    clearBounceIndicator() {
        if (this.indicatorEl) {
            this.indicatorEl.classList.remove('bounce');
        }
    }
    startCalibration() {
        if (this.isRunning) {
            this.updateStatus('Stop detection before calibrating', 'warning');
            return;
        }
        this.isCalibrating = true;
        this.calibrationSamples = [];
        window.addEventListener('devicemotion', this.handleMotion);
        this.updateStatus('Calibrating... Hold phone still', 'calibrating');
        if (this.calibrateBtn) {
            this.calibrateBtn.disabled = true;
        }
    }
    finishCalibration() {
        window.removeEventListener('devicemotion', this.handleMotion);
        this.isCalibrating = false;
        if (this.calibrationSamples.length > 0) {
            // Calculate average Z as baseline
            const sum = this.calibrationSamples.reduce((a, b) => a + b, 0);
            this.baselineZ = sum / this.calibrationSamples.length;
            this.updateStatus(`Calibrated! Baseline: ${this.baselineZ.toFixed(2)} m/s²`, 'ready');
            this.saveSettings();
        }
        if (this.calibrateBtn) {
            this.calibrateBtn.disabled = false;
        }
    }
    updateStatus(message, type) {
        if (this.statusEl) {
            this.statusEl.textContent = message;
            this.statusEl.className = `status ${type}`;
        }
    }
    updateBounceCount() {
        if (this.bounceCountEl) {
            this.bounceCountEl.textContent = this.bounceCount.toString();
        }
    }
    saveSettings() {
        const settings = {
            sensitivity: this.config.sensitivity,
            baselineZ: this.baselineZ,
            audioMode: this.config.audioMode,
            audioVolume: this.config.audioVolume
        };
        localStorage.setItem('bounceDetectorSettings', JSON.stringify(settings));
    }
    loadSettings() {
        try {
            const saved = localStorage.getItem('bounceDetectorSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                if (settings.sensitivity !== undefined) {
                    this.config.sensitivity = settings.sensitivity;
                    if (this.sensitivitySlider) {
                        this.sensitivitySlider.value = settings.sensitivity.toString();
                    }
                    if (this.sensitivityValue) {
                        this.sensitivityValue.textContent = settings.sensitivity.toFixed(1);
                    }
                }
                if (settings.baselineZ !== undefined) {
                    this.baselineZ = settings.baselineZ;
                }
                if (settings.audioMode !== undefined) {
                    this.config.audioMode = settings.audioMode;
                    if (this.audioModeSelect) {
                        this.audioModeSelect.value = settings.audioMode;
                    }
                }
                if (settings.audioVolume !== undefined) {
                    this.config.audioVolume = settings.audioVolume;
                    if (this.audioVolumeSlider) {
                        this.audioVolumeSlider.value = settings.audioVolume.toString();
                    }
                    if (this.audioVolumeValue) {
                        this.audioVolumeValue.textContent = Math.round(settings.audioVolume * 100).toString();
                    }
                }
            }
        }
        catch (e) {
            console.warn('Could not load settings:', e);
        }
    }
}
// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const detector = new BounceDetector();
    detector.init();
});
export { BounceDetector };
//# sourceMappingURL=bounce-detector.js.map