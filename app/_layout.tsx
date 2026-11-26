import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppRuntimeProvider } from '../src/app/AppRuntimeContext';
import { colors } from '../src/ui/tokens';

export default function RootLayout() {
  // Keep startup responsive while the real font loads, including on slow web connections.
  useFonts({ Manrope: Manrope_500Medium, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold });
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.ground }}><SafeAreaProvider>
      <StatusBar style="light" /><AppRuntimeProvider>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
          <Stack.Screen name="(tabs)" /><Stack.Screen name="settings" />
          <Stack.Screen name="barcode" options={{ animation: 'fade_from_bottom' }} /><Stack.Screen name="chatgpt" />
          <Stack.Screen name="onboarding" /><Stack.Screen name="food" options={{ animation: 'fade', animationDuration: 200 }} /><Stack.Screen name="recipes/index" />
          <Stack.Screen name="recipes/[id]" /><Stack.Screen name="recipes/batch/[batchId]" />
        </Stack>
      </AppRuntimeProvider>
    </SafeAreaProvider></GestureHandlerRootView>
  );
}
