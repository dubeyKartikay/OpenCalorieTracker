import { createElement, type ComponentType } from 'react';
import { Platform, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import {
  requireOptionalNativeModule,
  // Expo SDK 58 exports the native view loader under this name.
  requireNativeViewManager as requireNativeView,
} from 'expo-modules-core';
import { getFossScannerCapability, type BarcodeScannerPort, type DecodedBarcode } from '../../src/barcode/scannerPort';
import { createBarcodeScanTelemetry } from '../../src/barcode/types';

type CameraPermission = boolean | { granted?: boolean; status?: string };
interface NativeScannerModule {
  isAvailable(): boolean;
  requestCameraPermissionAsync(): Promise<CameraPermission>;
  getCameraPermissionAsync(): Promise<CameraPermission>;
  decodeImageUriAsync(uri: string): Promise<DecodedBarcode | null>;
}

export interface CapturedNativePhoto {
  uri: string;
  imageDataUrl: string;
  width: number;
  height: number;
  token: number;
}

export interface NativeBarcodeScannerViewProps extends ViewProps {
  active?: boolean;
  torchEnabled?: boolean;
  scanBarcodes?: boolean;
  captureToken?: number;
  onBarcodeScanned?: (event: NativeSyntheticEvent<DecodedBarcode>) => void;
  onPhotoCaptured?: (event: NativeSyntheticEvent<CapturedNativePhoto>) => void;
  onScannerError?: (event: NativeSyntheticEvent<{ message: string }>) => void;
}

function findNativeModule(): NativeScannerModule | null {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
  try {
    return requireOptionalNativeModule<NativeScannerModule>('OctBarcodeScanner');
  } catch {
    return null;
  }
}

const nativeModule = findNativeModule();
let nativeView: ComponentType<NativeBarcodeScannerViewProps> | null | undefined;

export function isNativeBarcodeScannerLinked(): boolean {
  try {
    return nativeModule?.isAvailable() === true;
  } catch {
    return false;
  }
}

function permissionGranted(permission: CameraPermission): boolean {
  return typeof permission === 'boolean' ? permission : permission.granted === true || permission.status === 'granted';
}

export async function requestNativeCameraPermission(): Promise<boolean> {
  if (!isNativeBarcodeScannerLinked() || !nativeModule) return false;
  return permissionGranted(await nativeModule.requestCameraPermissionAsync());
}

export async function getNativeCameraPermission(): Promise<boolean> {
  if (!isNativeBarcodeScannerLinked() || !nativeModule) return false;
  return permissionGranted(await nativeModule.getCameraPermissionAsync());
}

export function createNativeBarcodeScannerPort(): BarcodeScannerPort {
  const telemetry = createBarcodeScanTelemetry();
  return {
    capability: getFossScannerCapability(isNativeBarcodeScannerLinked(), Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web'),
    telemetry,
    async decode(input) {
      telemetry.decodeAttempts += 1;
      // Live frames stay in the native view; its onBarcodeScanned event goes to the resolver.
      if (input.kind !== 'photo' || !input.uri.trim() || !isNativeBarcodeScannerLinked() || !nativeModule) return null;
      const result = await nativeModule.decodeImageUriAsync(input.uri);
      if (!result || typeof result.rawCode !== 'string' || !result.rawCode.trim() ||
        typeof result.symbology !== 'string' || !result.symbology.trim()) return null;
      telemetry.decodeSuccesses += 1;
      return { rawCode: result.rawCode, symbology: result.symbology };
    },
  };
}

export function NativeBarcodeScannerView(props: NativeBarcodeScannerViewProps) {
  if (!isNativeBarcodeScannerLinked()) return null;
  if (nativeView === undefined) {
    try {
      nativeView = requireNativeView<NativeBarcodeScannerViewProps>('OctBarcodeScanner');
    } catch {
      nativeView = null;
    }
  }
  return nativeView ? createElement(nativeView, props) : null;
}
