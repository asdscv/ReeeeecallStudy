import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { initMobilePlatform } from './src/adapters';

// Initialize platform adapters
initMobilePlatform();

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>ReeeeecallStudy</Text>
      <Text style={styles.subtitle}>Mobile App — Phase 1 Setup Complete</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
  },
});
