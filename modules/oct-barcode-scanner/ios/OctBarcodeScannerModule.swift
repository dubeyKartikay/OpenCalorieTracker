import AVFoundation
import ExpoModulesCore
import ImageIO
import Vision

public final class OctBarcodeScannerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OctBarcodeScanner")

    Function("isAvailable") { true }

    AsyncFunction("requestCameraPermissionAsync") { (promise: Promise) in
      switch AVCaptureDevice.authorizationStatus(for: .video) {
      case .authorized: promise.resolve(true)
      case .notDetermined:
        AVCaptureDevice.requestAccess(for: .video) { granted in promise.resolve(granted) }
      default: promise.resolve(false)
      }
    }

    AsyncFunction("getCameraPermissionAsync") {
      AVCaptureDevice.authorizationStatus(for: .video) == .authorized
    }

    AsyncFunction("decodeImageUriAsync") { (uriString: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        autoreleasepool {
          guard let url = URL(string: uriString), url.isFileURL else {
            promise.reject("ERR_BARCODE_IMAGE_URI", "Expected a local file:// image URI.")
            return
          }
          guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            promise.reject("ERR_BARCODE_IMAGE", "Unable to open the barcode image.")
            return
          }
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
          let orientationValue = (properties?[kCGImagePropertyOrientation] as? NSNumber)?.uint32Value ?? 1
          let orientation = CGImagePropertyOrientation(rawValue: orientationValue) ?? .up
          let request = VNDetectBarcodesRequest()
          do {
            try VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:]).perform([request])
            let result = request.results?.compactMap { observation in
              OctBarcodeSymbology.detection(observation.payloadStringValue, OctBarcodeSymbology.name(observation.symbology))
            }.first
            promise.resolve(result)
          } catch {
            promise.reject("ERR_BARCODE_DECODE", error.localizedDescription)
          }
        }
      }
    }

    View(OctBarcodeScannerView.self) {
      Events("onBarcodeScanned", "onPhotoCaptured", "onScannerError")
      Prop("active") { (view: OctBarcodeScannerView, value: Bool) in view.active = value }
      Prop("torchEnabled") { (view: OctBarcodeScannerView, value: Bool) in view.torchEnabled = value }
      Prop("scanBarcodes") { (view: OctBarcodeScannerView, value: Bool) in view.scanBarcodes = value }
      Prop("captureToken") { (view: OctBarcodeScannerView, value: Int) in view.captureToken = value }
    }
  }
}
