import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The iPhone app: the same web app (dist/) in a native shell, so it looks and feels the same, plus
 * native GPS that keeps recording with the screen locked (ios/App/App/WalkTracker.swift).
 */
const config: CapacitorConfig = {
  appId: 'io.github.annvaskovska.mrsparkles',
  appName: 'Mr Sparkles',
  webDir: 'dist',
  // The paper the start screen is drawn on, so nothing flashes before the first paint.
  backgroundColor: '#f6f2e9',
  ios: {
    // index.html places everything around the notch itself, as in Safari (viewport-fit=cover).
    contentInset: 'never',
    // The page never scrolls; without this the web view rubber-bands under a two-finger drag.
    scrollEnabled: false,
    allowsLinkPreview: false,
    backgroundColor: '#f6f2e9',
    preferredContentMode: 'mobile',
  },
  plugins: {
    // Dark status bar text over the paper map.
    SystemBars: { style: 'LIGHT' },
  },
};

export default config;
