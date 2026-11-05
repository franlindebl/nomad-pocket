// The app's entry point. Background tasks must be defined before React loads, so a headless start (the system waking
// the app for a background check, with no UI) finds them; then Expo Router's own entry.
import './src/features/alerts/background';
import 'expo-router/entry';
