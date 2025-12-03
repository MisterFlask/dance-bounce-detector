# Dance Bounce Detector

A mobile app that uses your smartphone's accelerometer to detect vertical bouncing while dancing. When bouncing is detected, the phone vibrates to provide instant feedback, helping dancers break the habit of bouncing at each step.

**Available as both a Progressive Web App and a native Android app.**

## Features

- **Real-time bounce detection** using device accelerometer sensors
- **Haptic feedback** via vibration when bouncing is detected
- **Audio feedback modes**: Off, Discrete buzz, Continuous frequency, Frequency with fadeout
- **Adjustable sensitivity** to fine-tune detection threshold
- **Calibration mode** to set your baseline while standing still
- **Bounce counter** to track progress during practice
- **Works while phone is locked** (Android app only)
- **Dual gravity detection modes**: Device sensor fusion or software filter
- **Mobile-optimized UI** with dark theme

## Android App

The native Android app provides the best experience with reliable sensor access and background operation.

### Building the Android App

#### Prerequisites

- Android Studio Arctic Fox or later
- JDK 17
- Android SDK 34

#### Build Steps

1. Open Android Studio
2. Select "Open" and navigate to the `android/` folder
3. Wait for Gradle sync to complete
4. Connect your Android device or start an emulator
5. Click "Run" (green play button)

Or build from command line:

```bash
cd android
./gradlew assembleDebug
```

The APK will be at `android/app/build/outputs/apk/debug/app-debug.apk`

### Android App Features

- **Foreground service** - Continues detecting bounces when screen is off
- **Wake lock** - Keeps sensors active while locked
- **Notification** - Shows bounce count in notification bar
- **Material 3 design** - Modern, clean interface

## Web App (PWA)

The progressive web app works in any modern mobile browser.

### Usage

1. Visit the deployed web app on your mobile device
2. Grant motion sensor permissions when prompted (required on iOS 13+)
3. Optionally tap "Calibrate" while standing still to set your baseline
4. Tap "Start Detection" and begin dancing
5. The app will vibrate each time it detects a vertical bounce
6. Adjust the sensitivity slider if detecting too many or too few bounces

### Web Development

#### Prerequisites

- Node.js (v16 or later)
- npm

#### Setup

```bash
npm install
```

#### Build

```bash
npm run build
```

This compiles TypeScript from `src/` to JavaScript in `docs/` for GitHub Pages deployment.

#### Watch mode

```bash
npm run watch
```

### Web Deployment

The web app is deployed via GitHub Pages from the `/docs` folder. After building, commit and push to deploy.

## Technical Details

### Bounce Detection Algorithm

1. **Gravity tracking**: Uses device's gravity sensor or low-pass filter to determine "down" direction
2. **Vertical acceleration**: Projects total acceleration onto gravity vector
3. **Deviation detection**: Triggers when vertical acceleration deviates from baseline by more than sensitivity threshold
4. **Debouncing**: 300ms cooldown between detections to prevent multiple triggers per bounce

### Audio Feedback Modes

- **Off**: No audio, haptic only
- **Discrete**: Short buzz sound on each bounce detection
- **Frequency**: Continuous tone that rises in pitch with movement intensity
- **Frequency-Fadeout**: Continuous tone that also fades out when still

### Gravity Detection Modes

- **Sensor**: Uses device's built-in sensor fusion (more accurate, recommended)
- **Filter**: Uses software low-pass filter (fallback for devices without gravity sensor)

## Platform Support

| Platform | Support | Notes |
|----------|---------|-------|
| **Android App** | Full | All features including background operation |
| **Android Chrome** | Full | All features work including vibration |
| **iOS Safari** | Partial | No vibration API; requires iOS 13+ for motion permissions |
| **Desktop** | Limited | Accelerometer not available |

## License

MIT
