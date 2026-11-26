import AVFoundation
import ExpoModulesCore
import UIKit
import Vision

enum OctBarcodeSymbology {
  static let metadataTypes: [AVMetadataObject.ObjectType] = [
    .ean13, .ean8, .upce, .code128, .interleaved2of5, .itf14,
    .code39, .code39Mod43, .code93, .qr, .dataMatrix, .pdf417, .aztec,
    .gs1DataBar, .gs1DataBarLimited, .gs1DataBarExpanded
  ]

  static func name(_ type: AVMetadataObject.ObjectType) -> String? {
    switch type {
    case .ean13: return "EAN-13"
    case .ean8: return "EAN-8"
    case .upce: return "UPC-E"
    case .code128: return "Code-128"
    case .interleaved2of5, .itf14: return "ITF"
    case .code39, .code39Mod43: return "Code-39"
    case .code93: return "Code-93"
    case .qr: return "QR"
    case .dataMatrix: return "DataMatrix"
    case .pdf417: return "PDF417"
    case .aztec: return "Aztec"
    case .gs1DataBar, .gs1DataBarLimited: return "DataBar"
    case .gs1DataBarExpanded: return "DataBar-Expanded"
    default: return nil
    }
  }

  static func name(_ type: VNBarcodeSymbology) -> String? {
    switch type {
    case .ean13: return "EAN-13"
    case .ean8: return "EAN-8"
    case .upce: return "UPC-E"
    case .code128: return "Code-128"
    case .i2of5, .i2of5Checksum, .itf14: return "ITF"
    case .code39, .code39Checksum, .code39FullASCII, .code39FullASCIIChecksum: return "Code-39"
    case .code93, .code93i: return "Code-93"
    case .qr: return "QR"
    case .microQR: return "Micro-QR"
    case .dataMatrix: return "DataMatrix"
    case .pdf417: return "PDF417"
    case .microPDF417: return "Micro-PDF417"
    case .aztec: return "Aztec"
    case .gs1DataBar, .gs1DataBarLimited: return "DataBar"
    case .gs1DataBarExpanded: return "DataBar-Expanded"
    default: return nil
    }
  }

  static func detection(_ text: String?, _ symbology: String?) -> [String: String]? {
    guard let text, let symbology,
      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      !text.contains("\u{0000}"), !text.contains("\u{FFFD}") else { return nil }
    return ["rawCode": text, "symbology": symbology]
  }
}

final class OctBarcodeScannerView: ExpoView, AVCaptureMetadataOutputObjectsDelegate, AVCapturePhotoCaptureDelegate {
  let onBarcodeScanned = EventDispatcher()
  let onPhotoCaptured = EventDispatcher()
  let onScannerError = EventDispatcher()
  var active = true { didSet { updateSession() } }
  var torchEnabled = false { didSet { updateSession() } }
  var scanBarcodes = true
  var captureToken = 0 {
    didSet {
      if captureToken > 0 && captureToken != lastHandledCaptureToken {
        lastHandledCaptureToken = captureToken
        triggerPhotoCapture(captureToken)
      }
    }
  }

  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "org.opencalorietracker.barcode.camera")
  private let photoOutput = AVCapturePhotoOutput()
  private lazy var previewLayer = AVCaptureVideoPreviewLayer(session: session)
  private var device: AVCaptureDevice?
  private var configured = false
  private var observers: [NSObjectProtocol] = []
  // UI generation is accessed on main; sessionGeneration and debounce state on sessionQueue.
  private var generation = 0
  private var sessionGeneration = 0
  private var lastHandledCaptureToken = 0
  private var pendingCaptureToken = 0
  private var lastCode: String?
  private var lastDetectionTime: TimeInterval = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)
    for notification in [UIApplication.willResignActiveNotification, UIApplication.didBecomeActiveNotification] {
      observers.append(NotificationCenter.default.addObserver(forName: notification, object: nil, queue: .main) { [weak self] note in
        self?.updateSession(foreground: note.name == UIApplication.didBecomeActiveNotification)
      })
    }
    observers.append(NotificationCenter.default.addObserver(forName: .AVCaptureSessionRuntimeError, object: session, queue: .main) { [weak self] note in
      self?.onScannerError(["message": (note.userInfo?[AVCaptureSessionErrorKey] as? Error)?.localizedDescription ?? "Camera capture failed."])
    })
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateSession()
  }

  private func updateSession(foreground: Bool? = nil) {
    let shouldRun = active && window != nil && (foreground ?? (UIApplication.shared.applicationState == .active))
    let torch = torchEnabled
    generation += 1
    let token = generation
    sessionQueue.async { [weak self] in
      guard let self else { return }
      self.sessionGeneration = token
      guard shouldRun else { self.stopSession(); return }
      guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
        self.stopSession()
        self.reportError("Camera permission is required to scan barcodes.", token)
        return
      }
      do {
        if !self.configured { try self.configureSession() }
        if !self.session.isRunning { self.session.startRunning() }
      } catch {
        self.stopSession()
        self.reportError(error.localizedDescription, token)
        return
      }
      do {
        try self.setTorch(torch)
      } catch {
        self.reportError(error.localizedDescription, token)
      }
    }
  }

  private func configureSession() throws {
    guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
      throw NSError(domain: "OctBarcodeScanner", code: 1, userInfo: [NSLocalizedDescriptionKey: "No rear camera is available on this device."])
    }
    let input = try AVCaptureDeviceInput(device: camera)
    let output = AVCaptureMetadataOutput()
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    session.sessionPreset = .high
    guard session.canAddInput(input) else {
      throw NSError(domain: "OctBarcodeScanner", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unable to attach camera input."])
    }
    session.addInput(input)
    guard session.canAddOutput(output) else {
      session.removeInput(input)
      throw NSError(domain: "OctBarcodeScanner", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unable to attach barcode output."])
    }
    session.addOutput(output)
    output.setMetadataObjectsDelegate(self, queue: sessionQueue)
    output.metadataObjectTypes = OctBarcodeSymbology.metadataTypes.filter { output.availableMetadataObjectTypes.contains($0) }
    if session.canAddOutput(photoOutput) {
      session.addOutput(photoOutput)
    }
    device = camera
    configured = true
  }

  private func triggerPhotoCapture(_ token: Int) {
    sessionQueue.async { [weak self] in
      guard let self, self.session.isRunning else {
        self?.reportError("Camera is still starting. Tap shutter again in a moment.", self?.sessionGeneration ?? 0)
        return
      }
      self.pendingCaptureToken = token
      let settings = AVCapturePhotoSettings()
      self.photoOutput.capturePhoto(with: settings, delegate: self)
    }
  }

  func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    let token = pendingCaptureToken
    if let error {
      reportError(error.localizedDescription, sessionGeneration)
      return
    }
    guard let rawData = photo.fileDataRepresentation(), let uiImage = UIImage(data: rawData) else {
      reportError("Captured photo could not be read.", sessionGeneration)
      return
    }
    let longest = max(uiImage.size.width, uiImage.size.height)
    let scale = longest > 1600 ? 1600 / longest : 1.0
    let targetSize = CGSize(width: max(1, round(uiImage.size.width * scale)), height: max(1, round(uiImage.size.height * scale)))
    let renderer = UIGraphicsImageRenderer(size: targetSize)
    let normalized = renderer.image { _ in uiImage.draw(in: CGRect(origin: .zero, size: targetSize)) }
    guard let jpegData = normalized.jpegData(compressionQuality: 0.78) else {
      reportError("Captured photo could not be encoded.", sessionGeneration)
      return
    }
    let fileUrl = FileManager.default.temporaryDirectory.appendingPathComponent("oct_meal_\(Int(Date().timeIntervalSince1970 * 1000)).jpg")
    do {
      try jpegData.write(to: fileUrl)
      let payload: [String: Any] = [
        "uri": fileUrl.absoluteString,
        "imageDataUrl": "data:image/jpeg;base64,\(jpegData.base64EncodedString())",
        "width": Int(targetSize.width),
        "height": Int(targetSize.height),
        "token": token
      ]
      DispatchQueue.main.async { [weak self] in
        self?.onPhotoCaptured(payload)
      }
    } catch {
      reportError(error.localizedDescription, sessionGeneration)
    }
  }

  private func setTorch(_ enabled: Bool) throws {
    guard let device else { return }
    guard device.hasTorch else {
      if enabled {
        throw NSError(domain: "OctBarcodeScanner", code: 4, userInfo: [NSLocalizedDescriptionKey: "This camera does not have a torch."])
      }
      return
    }
    try device.lockForConfiguration()
    defer { device.unlockForConfiguration() }
    device.torchMode = enabled ? .on : .off
  }

  private func stopSession() {
    try? setTorch(false)
    if session.isRunning { session.stopRunning() }
    lastCode = nil
    lastDetectionTime = 0
  }

  func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
    guard session.isRunning, scanBarcodes else { return }
    for case let barcode as AVMetadataMachineReadableCodeObject in metadataObjects {
      guard let result = OctBarcodeSymbology.detection(barcode.stringValue, OctBarcodeSymbology.name(barcode.type)),
        let code = result["rawCode"] else { continue }
      let now = ProcessInfo.processInfo.systemUptime
      if lastCode == code && now - lastDetectionTime < 1.2 { return }
      lastCode = code
      lastDetectionTime = now
      let token = sessionGeneration
      DispatchQueue.main.async { [weak self] in
        guard let self, self.generation == token, self.active, self.window != nil else { return }
        self.onBarcodeScanned(result)
      }
      return
    }
  }

  private func reportError(_ message: String, _ token: Int) {
    DispatchQueue.main.async { [weak self] in
      guard let self, self.generation == token else { return }
      self.onScannerError(["message": message])
    }
  }

  deinit {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    let captureSession = session
    let captureDevice = device
    sessionQueue.async {
      if let captureDevice, captureDevice.hasTorch, (try? captureDevice.lockForConfiguration()) != nil {
        captureDevice.torchMode = .off
        captureDevice.unlockForConfiguration()
      }
      if captureSession.isRunning { captureSession.stopRunning() }
    }
  }
}
