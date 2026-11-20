import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The iPhone app: the same web app (dist/) in a native shell, so it looks and feels the same, plus
 * native GPS that keeps recording with the screen locked (ios/App/App/WalkTracker.swift).
 */
const config: CapacitorConfig = {
  appId: 'io.github.annvaskovska.wanderlight',
  appName: 'Wanderlight',
  webDir: 'dist',
  // The night the start screen is drawn on, so nothing flashes white before the first paint.
  backgroundColor: '#0b0d12',
  ios: {
    // index.html places everything around the notch itself, as in Safari (viewport-fit=cover).
    contentInset: 'never',
    // The page never scrolls; without this the web view rubber-bands under a two-finger drag.
    scrollEnabled: false,
    allowsLinkPreview: false,
    backgroundColor: '#0b0d12',
    preferredContentMode: 'mobile',
  },
  plugins: {
    // Light status bar text over the night map, as Safari's black-translucent bar gives the web app.
    SystemBars: { style: 'DARK' },
  },
};

export default config;
