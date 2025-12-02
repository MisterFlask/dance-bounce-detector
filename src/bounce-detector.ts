/**
 * Dance Bounce Detector
 * Detects vertical bouncing using the smartphone accelerometer
 * and provides haptic feedback to help dancers avoid habitual bouncing.
 */

interface BounceDetectorConfig {
  sensitivity: number;        // Threshold for bounce detection (m/s^2)
  debounceTime: number;       // Minimum time between bounce detections (ms)
  vibrationDuration: number;  // How long to vibrate (ms)
  sampleWindow: number;       // Number of samples to analyze
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

  // UI Elements
  private statusEl: HTMLElement | null = null;
  private indicatorEl: HTMLElement | null = null;
  private sensitivitySlider: HTMLInputElement | null = null;
  private sensitivityValue: HTMLElement | null = null;
  private startBtn: HTMLButtonElement | null = null;
  private calibrateBtn: HTMLButtonElement | null = null;
  private bounceCountEl: HTMLElement | null = null;
  private currentAccelEl: HTMLElement | null = null;

  private bounceCount: number = 0;
  private permissionGranted: boolean = false;

  constructor(config: Partial<BounceDetectorConfig> = {}) {
    this.config = {
      sensitivity: 3.0,         // Default threshold in m/s^2 above/below gravity
      debounceTime: 300,        // 300ms between detections
      vibrationDuration: 100,   // 100ms vibration
      sampleWindow: 10,         // Analyze last 10 samples
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

    this.isRunning = true;
    this.bounceCount = 0;
    this.updateBounceCount();

    window.addEventListener('devicemotion', this.handleMotion);

    if (this.startBtn) {
      this.startBtn.textContent = 'Stop Detection';
      this.startBtn.classList.add('active');
    }

    this.updateStatus('Detecting bounces...', 'active');
  }

  private stopDetection(): void {
    this.isRunning = false;

    window.removeEventListener('devicemotion', this.handleMotion);

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
      baselineZ: this.baselineZ
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
