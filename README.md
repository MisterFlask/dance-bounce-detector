# Dance Bounce Detector

A progressive web app that uses your smartphone's accelerometer to detect vertical bouncing while dancing. When bouncing is detected, the phone vibrates to provide instant feedback, helping dancers break the habit of bouncing at each step.

## Features

- **Real-time bounce detection** using the DeviceMotion API
- **Haptic feedback** via the Vibration API when bouncing is detected
- **Adjustable sensitivity** to fine-tune detection threshold
- **Calibration mode** to set your baseline while standing still
- **Bounce counter** to track progress during practice
- **Mobile-optimized UI** designed for smartphone use

## Usage

1. Open the app on your mobile device
2. Grant motion sensor permissions when prompted (required on iOS 13+)
3. Optionally tap "Calibrate" while standing still to set your baseline
4. Tap "Start Detection" and begin dancing
5. The app will vibrate each time it detects a vertical bounce
6. Adjust the sensitivity slider if detecting too many or too few bounces

## Development

### Prerequisites

- Node.js (v16 or later)
- npm

### Setup

```bash
npm install
```

### Build

```bash
npm run build
```

This compiles TypeScript from `src/` to JavaScript in `docs/` for GitHub Pages deployment.

### Watch mode

```bash
npm run watch
```

## Deployment

The app is deployed via GitHub Pages from the `/docs` folder. After building, commit and push to deploy.

## Technical Details

- **Accelerometer**: Uses `accelerationIncludingGravity.z` to detect vertical movement
- **Bounce detection**: Triggers when acceleration deviates from baseline by more than the sensitivity threshold
- **Debouncing**: 300ms cooldown between detections to prevent multiple triggers per bounce
- **Persistence**: Settings are saved to localStorage

## Browser Support

- Android: Chrome, Firefox, Edge
- iOS: Safari (requires iOS 13+ for motion permissions)

Note: The Vibration API is not supported on iOS, so visual feedback only will be used on iPhones.

## License

MIT
