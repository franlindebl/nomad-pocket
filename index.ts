// The app's entry point. Background tasks must be defined before React loads, so a headless start (the system waking
// the app for a background check, or the car opening it, with no UI) finds them; then Expo Router's own entry.
import './src/features/alerts/background';
// The car's JS task (Android Auto / Automotive): the app's startup without UI when the car opens it.
import './src/features/carplay/headless';
import 'expo-router/entry';
