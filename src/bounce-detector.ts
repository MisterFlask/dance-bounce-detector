/**
 * Dance Bounce Detector
 * Detects vertical bouncing using the smartphone accelerometer
 * and provides haptic feedback to help dancers avoid habitual bouncing.
 */

type AudioFeedbackMode = 'off' | 'discrete' | 'frequency' | 'frequency-fadeout';

interface BounceDetectorConfig {
  sensitivity: number;        // Threshold for bounce detection (m/s^2)
  debounceTime: number;       // Minimum time between bounce detections (ms)
  vibrationDuration: number;  // How long to vibrate (ms)
  sampleWindow: number;       // Number of samples to analyze
  audioMode: AudioFeedbackMode;  // Audio feedback mode
  audioVolume: number;        // Audio volume (0.0 to 1.0)
}

interface AccelerationSample {
  timestamp: number;
  z: number;  // Vertical acceleration
}

class BounceDetector {
  private config: BounceDetectorConfig;
  private isRunning: boolean = false;
  private lastBounceTime: number = 0;
  private samples: AccelerationSample[] = [];
  private baselineZ: number = 9.81;  // Earth's gravity
  private calibrationSamples: number[] = [];
  private isCalibrating: boolean = false;

  // Audio properties
  private audioContext: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;
  private oscillatorGainNode: GainNode | null = null;  // Separate gain for oscillator volume fadeout
  private isAudioInitialized: boolean = false;

  // UI Elements
  private statusEl: HTMLElement | null = null;
  private indicatorEl: HTMLElement | null = null;
  private sensitivitySlider: HTMLInputElement | null = null;
  private sensitivityValue: HTMLElement | null = null;
  private startBtn: HTMLButtonElement | null = null;
  private calibrateBtn: HTMLButtonElement | null = null;
  private bounceCountEl: HTMLElement | null = null;
  private currentAccelEl: HTMLElement | null = null;
  private audioModeSelect: HTMLSelectElement | null = null;
  private audioVolumeSlider: HTMLInputElement | null = null;
  private audioVolumeValue: HTMLElement | null = null;

  private bounceCount: number = 0;
  private permissionGranted: boolean = false;

  constructor(config: Partial<BounceDetectorConfig> = {}) {
    this.config = {
      sensitivity: 3.0,         // Default threshold in m/s^2 above/below gravity
      debounceTime: 300,        // 300ms between detections
      vibrationDuration: 100,   // 100ms vibration
      sampleWindow: 10,         // Analyze last 10 samples
      audioMode: 'off',         // Audio feedback off by default
      audioVolume: 0.5,         // 50% volume by default
      ...config
    };
  }

  public init(): void {
    this.bindUIElements();
    this.setupEventListeners();
    this.checkDeviceSupport();
    this.loadSettings();
  }

  private bindUIElements(): void {
    this.statusEl = document.getElementById('status');
    this.indicatorEl = document.getElementById('bounce-indicator');
    this.sensitivitySlider = document.getElementById('sensitivity') as HTMLInputElement;
    this.sensitivityValue = document.getElementById('sensitivity-value');
    this.startBtn = document.getElementById('start-btn') as HTMLButtonElement;
    this.calibrateBtn = document.getElementById('calibrate-btn') as HTMLButtonElement;
    this.bounceCountEl = document.getElementById('bounce-count');
    this.currentAccelEl = document.getElementById('current-accel');
    this.audioModeSelect = document.getElementById('audio-mode') as HTMLSelectElement;
    this.audioVolumeSlider = document.getElementById('audio-volume') as HTMLInputElement;
    this.audioVolumeValue = document.getElementById('audio-volume-value');
  }

  private setupEventListeners(): void {
    this.startBtn?.addEventListener('click', () => this.toggleDetection());
    this.calibrateBtn?.addEventListener('click', () => this.startCalibration());

    this.sensitivitySlider?.addEventListener('input', (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      this.config.sensitivity = value;
      if (this.sensitivityValue) {
        this.sensitivityValue.textContent = value.toFixed(1);
      }
      this.saveSettings();
    });

    this.audioModeSelect?.addEventListener('change', (e) => {
      const mode = (e.target as HTMLSelectElement).value as AudioFeedbackMode;
      this.config.audioMode = mode;
      this.handleAudioModeChange();
      this.saveSettings();
    });

    this.audioVolumeSlider?.addEventListener('input', (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
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

  private checkDeviceSupport(): void {
    const hasAccelerometer = 'DeviceMotionEvent' in window;
    const hasVibration = 'vibrate' in navigator;

    if (!hasAccelerometer) {
      this.updateStatus('Accelerometer not supported on this device', 'error');
      if (this.startBtn) this.startBtn.disabled = true;
      return;
    }

    if (!hasVibration) {
      this.updateStatus('Vibration not supported - visual feedback only', 'warning');
    }

    this.updateStatus('Ready to start', 'ready');
  }

  private async requestPermission(): Promise<boolean> {
    // iOS 13+ requires permission request
    if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
      try {
        const permission = await (DeviceMotionEvent as any).requestPermission();
        if (permission === 'granted') {
          this.permissionGranted = true;
          return true;
        } else {
          this.updateStatus('Permission denied. Please allow motion access.', 'error');
          return false;
        }
      } catch (error) {
        this.updateStatus('Error requesting permission', 'error');
        console.error('Permission error:', error);
        return false;
      }
    }
    // Android and older iOS don't need explicit permission
    this.permissionGranted = true;
    return true;
  }

  private async toggleDetection(): Promise<void> {
    if (this.isRunning) {
      this.stopDetection();
    } else {
      await this.startDetection();
    }
  }

  private async startDetection(): Promise<void> {
    if (!this.permissionGranted) {
      const granted = await this.requestPermission();
      if (!granted) return;
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

    // Start frequency audio if in a frequency mode
    if (this.config.audioMode === 'frequency' || this.config.audioMode === 'frequency-fadeout') {
      this.startFrequencyAudio();
    }

    if (this.startBtn) {
      this.startBtn.textContent = 'Stop Detection';
      this.startBtn.classList.add('active');
    }

    this.updateStatus('Detecting bounces...', 'active');
  }

  private stopDetection(): void {
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

  private handleMotion = (event: DeviceMotionEvent): void => {
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
    } else if (this.config.audioMode === 'frequency-fadeout') {
      this.updateFrequencyFadeoutFromDeviation(deviation);
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

  private detectBounce(currentZ: number, now: number): boolean {
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

  private onBounceDetected(): void {
    this.bounceCount++;
    this.updateBounceCount();
    this.triggerFeedback();
    this.showBounceIndicator();
  }

  private triggerFeedback(): void {
    // Vibration feedback
    if ('vibrate' in navigator) {
      navigator.vibrate(this.config.vibrationDuration);
    }

    // Discrete audio feedback (buzz on bounce detection)
    if (this.config.audioMode === 'discrete') {
      this.playDiscreteBuzz();
    }
  }

  private initAudio(): void {
    if (this.isAudioInitialized) return;

    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.gainNode = this.audioContext.createGain();
      this.gainNode.connect(this.audioContext.destination);
      this.gainNode.gain.value = this.config.audioVolume;
      this.isAudioInitialized = true;
    } catch (e) {
      console.warn('Web Audio API not supported:', e);
    }
  }

  private async handleAudioModeChange(): Promise<void> {
    if (this.config.audioMode !== 'off' && !this.isAudioInitialized) {
      this.initAudio();
      // Resume audio context during user gesture (dropdown change)
      if (this.audioContext && this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
    }

    // Stop frequency audio if switching away from frequency modes
    if (this.config.audioMode !== 'frequency' && this.config.audioMode !== 'frequency-fadeout') {
      this.stopFrequencyAudio();
    }

    // Start frequency audio if switching to a frequency mode and detection is running
    if ((this.config.audioMode === 'frequency' || this.config.audioMode === 'frequency-fadeout') && this.isRunning) {
      this.startFrequencyAudio();
    }
  }

  private async startFrequencyAudio(): Promise<void> {
    if (!this.audioContext || !this.gainNode) {
      this.initAudio();
    }

    if (!this.audioContext || !this.gainNode) return;

    // Resume audio context if suspended (needed for browsers with autoplay policies)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // Stop existing oscillator if any
    this.stopFrequencyAudio();

    // Create oscillator gain node for independent volume control (used in fadeout mode)
    this.oscillatorGainNode = this.audioContext.createGain();
    // For frequency-fadeout mode, start quiet and let deviation control volume
    // For regular frequency mode, start at full volume
    this.oscillatorGainNode.gain.value = this.config.audioMode === 'frequency-fadeout' ? 0.1 : 1.0;
    this.oscillatorGainNode.connect(this.gainNode);

    // Create oscillator for continuous frequency feedback
    this.oscillator = this.audioContext.createOscillator();
    this.oscillator.type = 'sine';
    this.oscillator.frequency.value = 200; // Base frequency in Hz
    this.oscillator.connect(this.oscillatorGainNode);
    this.oscillator.start();
  }

  private stopFrequencyAudio(): void {
    if (this.oscillator) {
      try {
        this.oscillator.stop();
        this.oscillator.disconnect();
      } catch (e) {
        // Oscillator might already be stopped
      }
      this.oscillator = null;
    }
    if (this.oscillatorGainNode) {
      try {
        this.oscillatorGainNode.disconnect();
      } catch (e) {
        // Gain node might already be disconnected
      }
      this.oscillatorGainNode = null;
    }
  }

  private updateFrequencyFromDeviation(deviation: number): void {
    if (!this.oscillator || this.config.audioMode !== 'frequency') return;

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
    this.oscillator.frequency.setTargetAtTime(
      frequency,
      this.audioContext!.currentTime,
      0.05 // Time constant for smooth transition
    );
  }

  private updateFrequencyFadeoutFromDeviation(deviation: number): void {
    if (!this.oscillator || !this.oscillatorGainNode || this.config.audioMode !== 'frequency-fadeout') return;

    // Map deviation to frequency (same as regular frequency mode):
    // - 0 deviation = 200 Hz (low, calm)
    // - max deviation (e.g., 10 m/s²) = 1000 Hz (high, alert)
    const minFreq = 200;
    const maxFreq = 1000;
    const maxDeviation = 10; // Maximum expected deviation in m/s²

    const normalizedDeviation = Math.min(deviation / maxDeviation, 1);
    const frequency = minFreq + (maxFreq - minFreq) * normalizedDeviation;

    // Smooth frequency transition
    this.oscillator.frequency.setTargetAtTime(
      frequency,
      this.audioContext!.currentTime,
      0.05 // Time constant for smooth transition
    );

    // Map deviation to volume:
    // - 0 deviation = 0.1 (quiet base level, barely audible)
    // - max deviation = 1.0 (full volume)
    // Volume quickly rises with deviation, then fades out when deviation decreases
    const minVolume = 0.1;
    const maxVolume = 1.0;
    const volume = minVolume + (maxVolume - minVolume) * normalizedDeviation;

    // Smooth volume transition with fadeout effect
    // Use a shorter time constant for rising (0.02s) and longer for falling (0.15s)
    // to create a "punch in, fade out" effect
    const currentVolume = this.oscillatorGainNode.gain.value;
    const timeConstant = volume > currentVolume ? 0.02 : 0.15;

    this.oscillatorGainNode.gain.setTargetAtTime(
      volume,
      this.audioContext!.currentTime,
      timeConstant
    );
  }

  private playDiscreteBuzz(): void {
    if (!this.audioContext || !this.gainNode) {
      this.initAudio();
    }

    if (!this.audioContext || !this.gainNode) return;

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

  private showBounceIndicator(): void {
    if (this.indicatorEl) {
      this.indicatorEl.classList.add('bounce');
      setTimeout(() => this.clearBounceIndicator(), 200);
    }
  }

  private clearBounceIndicator(): void {
    if (this.indicatorEl) {
      this.indicatorEl.classList.remove('bounce');
    }
  }

  private startCalibration(): void {
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

  private finishCalibration(): void {
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

  private updateStatus(message: string, type: string): void {
    if (this.statusEl) {
      this.statusEl.textContent = message;
      this.statusEl.className = `status ${type}`;
    }
  }

  private updateBounceCount(): void {
    if (this.bounceCountEl) {
      this.bounceCountEl.textContent = this.bounceCount.toString();
    }
  }

  private saveSettings(): void {
    const settings = {
      sensitivity: this.config.sensitivity,
      baselineZ: this.baselineZ,
      audioMode: this.config.audioMode,
      audioVolume: this.config.audioVolume
    };
    localStorage.setItem('bounceDetectorSettings', JSON.stringify(settings));
  }

  private loadSettings(): void {
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
          this.config.audioMode = settings.audioMode as AudioFeedbackMode;
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
    } catch (e) {
      console.warn('Could not load settings:', e);
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const detector = new BounceDetector();
  detector.init();
});

export { BounceDetector, BounceDetectorConfig };
