import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The iPhone app: the same web app (dist/) in a native shell, so it looks and feels the same, plus
 * native GPS that keeps recording with the screen locked (ios/App/App/WalkTracker.swift).
 */
const config: CapacitorConfig = {
  appId: 'io.github.annvaskovska.mrsparkles',
  appName: 'Mr Sparkles',
  webDir: 'dist',
  // The cover's yellow (the start screen), so nothing flashes before the first paint.
  backgroundColor: '#ffd23f',
  ios: {
    // index.html places everything around the notch itself, as in Safari (viewport-fit=cover).
    contentInset: 'never',
    // The page never scrolls; without this the web view rubber-bands under a two-finger drag.
    scrollEnabled: false,
    allowsLinkPreview: false,
    backgroundColor: '#ffd23f',
    preferredContentMode: 'mobile',
  },
  plugins: {
    // Dark status bar text over the yellow cover and the paper map.
    SystemBars: { style: 'LIGHT' },
  },
};

export default config;
