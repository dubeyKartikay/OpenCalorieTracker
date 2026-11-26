import type { BarcodeScanTelemetry } from './types';

export interface DecodedBarcode { rawCode: string; symbology: string }
export interface FossScannerCapability {
  liveCamera: {
    engine: 'zxing-cpp' | 'avfoundation'; license: 'Apache-2.0' | 'Apple-SDK';
    nativePackages: readonly string[];
    requiresNativeDevBuild: true; available: boolean; description: string;
  };
  manualEntry: { available: true; description: string };
  photoEntry: { engine: 'zxing-cpp' | 'vision' | 'zxing-wasm'; requiresLinkedDecoder: boolean; description: string };
  bundlesGoogleMlKit: false;
}

/** A descriptor only: no native or proprietary scanner binaries are imported here. */
export function getFossScannerCapability(nativeDecoderLinked = false, platform: 'android' | 'ios' | 'web' = 'android'): FossScannerCapability {
  const isIos = platform === 'ios';
  return {
    liveCamera: {
      engine: isIos ? 'avfoundation' : 'zxing-cpp',
      license: isIos ? 'Apple-SDK' : 'Apache-2.0',
      nativePackages: ['oct-barcode-scanner'],
      requiresNativeDevBuild: true, available: nativeDecoderLinked,
      description: nativeDecoderLinked
        ? isIos
          ? 'Live barcode scanning uses Apple AVFoundation with zero proprietary Google ML Kit binaries.'
          : 'Live barcode scanning uses FOSS CameraX + zxing-cpp (Apache-2.0) with zero Google ML Kit binaries.'
        : 'Live scanning requires a FOSS native dev build with oct-barcode-scanner linked (CameraX + zxing-cpp on Android, AVFoundation on iOS); unavailable in Expo Go.',
    },
    manualEntry: { available: true, description: 'Use the keypad today; select UPC-E or EAN-8 for an eight-digit code.' },
    photoEntry: {
      engine: isIos ? 'vision' : nativeDecoderLinked ? 'zxing-cpp' : 'zxing-wasm',
      requiresLinkedDecoder: !nativeDecoderLinked,
      description: nativeDecoderLinked
        ? 'Photo barcode decoding is available offline via the linked native FOSS decoder.'
        : 'A FOSS image decoder can provide photo barcodes; pasted/OCR nutrition text can be entered offline today.',
    },
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
