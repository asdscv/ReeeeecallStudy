import { LogBox } from 'react-native';
import { registerRootComponent } from 'expo';

import App from './App';

// Suppress yellow warning box in development (blocks tab bar during E2E tests)
if (__DEV__) {
  LogBox.ignoreAllLogs(true);
}

registerRootComponent(App);
