import type { BarcodeScanTelemetry } from './types';

export interface DecodedBarcode { rawCode: string; symbology: string }
export interface FossScannerCapability {
  liveCamera: {
    engine: 'zxing-cpp'; license: 'Apache-2.0';
    nativePackages: readonly ['react-native-vision-camera', 'react-native-nitro-zxing'];
    requiresNativeDevBuild: true; available: boolean; description: string;
  };
  manualEntry: { available: true; description: string };
  photoEntry: { engine: 'zxing-wasm'; requiresLinkedDecoder: true; description: string };
  bundlesGoogleMlKit: false;
}

/** A descriptor only: no native or proprietary scanner binaries are imported here. */
export function getFossScannerCapability(nativeDecoderLinked = false): FossScannerCapability {
  return {
    liveCamera: {
      engine: 'zxing-cpp', license: 'Apache-2.0',
      nativePackages: ['react-native-vision-camera', 'react-native-nitro-zxing'],
      requiresNativeDevBuild: true, available: nativeDecoderLinked,
      description: 'Live scanning requires a FOSS native dev build with both packages linked and tested on the target device; unavailable in Expo Go.',
    },
    manualEntry: { available: true, description: 'Use the keypad today; select UPC-E or EAN-8 for an eight-digit code.' },
    photoEntry: { engine: 'zxing-wasm', requiresLinkedDecoder: true, description: 'A FOSS image decoder can provide photo barcodes; pasted/OCR nutrition text can be entered offline today.' },
    bundlesGoogleMlKit: false,
  };
}

/** Implementations decode only. Manual input goes directly to BarcodeResolver. */
export interface BarcodeScannerPort {
  readonly capability: FossScannerCapability;
  readonly telemetry: BarcodeScanTelemetry;
  /** Increment decodeAttempts for each decode call and decodeSuccesses for non-null results. */
  decode(input: { kind: 'camera_frame'; frame: unknown } | { kind: 'photo'; uri: string }): Promise<DecodedBarcode | null>;
}
