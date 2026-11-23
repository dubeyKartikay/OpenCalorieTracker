import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppRuntimeProvider } from '../src/app/AppRuntimeContext';
import { colors } from '../src/ui/tokens';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.ground }}><SafeAreaProvider>
      <StatusBar style="light" /><AppRuntimeProvider>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
          <Stack.Screen name="(tabs)" /><Stack.Screen name="settings" />
        </Stack>
      </AppRuntimeProvider>
    </SafeAreaProvider></GestureHandlerRootView>
  );
}
