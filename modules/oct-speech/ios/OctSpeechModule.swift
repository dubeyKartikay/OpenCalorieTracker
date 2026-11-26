import AVFoundation
import ExpoModulesCore
import Speech

public final class OctSpeechModule: Module {
  private let audioEngine = AVAudioEngine()
  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private var activeSessionId: Int = 0
  private var sessionCounter: Int = 0
  private var isListening: Bool = false

  public func definition() -> ModuleDefinition {
    Name("OctSpeech")

    Events(
      "onSpeechState",
      "onSpeechVolume",
      "onSpeechPartial",
      "onSpeechResult",
      "onSpeechError"
    )

    Function("getCapability") { () -> [String: Any?] in
      let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
      let available = recognizer?.isAvailable ?? false
      let onDevice = recognizer?.supportsOnDeviceRecognition ?? false
      return [
        "available": available,
        "onDeviceAvailable": onDevice,
        "platform": "ios",
        "reason": available ? nil : "Speech recognition is currently unavailable on this iOS device."
      ]
    }

    AsyncFunction("getPermissionAsync") { () -> Bool in
      let speechOk = SFSpeechRecognizer.authorizationStatus() == .authorized
      let micOk = AVAudioSession.sharedInstance().recordPermission == .granted
      return speechOk && micOk
    }

    AsyncFunction("requestPermissionAsync") { (promise: Promise) in
      SFSpeechRecognizer.requestAuthorization { speechStatus in
        guard speechStatus == .authorized else {
          promise.resolve(false)
          return
        }
        AVAudioSession.sharedInstance().requestRecordPermission { micGranted in
          promise.resolve(micGranted)
        }
      }
    }

    AsyncFunction("startListeningAsync") { (options: [String: Any]?, promise: Promise) in
      DispatchQueue.main.async {
        guard SFSpeechRecognizer.authorizationStatus() == .authorized,
              AVAudioSession.sharedInstance().recordPermission == .granted else {
          promise.reject("E_PERMISSION", "Microphone and speech permissions are required for voice dictation.")
          return
        }

        self.teardown(emitEnded: false)
        self.sessionCounter += 1
        let sessionId = self.sessionCounter
        self.activeSessionId = sessionId

        let localeId = (options?["locale"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let locale = (localeId != nil && !localeId!.isEmpty) ? Locale(identifier: localeId!) : Locale.current
        guard let recognizer = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
              recognizer.isAvailable else {
          promise.reject("E_UNAVAILABLE", "Speech recognition is unavailable for this language.")
          return
        }

        do {
          let audioSession = AVAudioSession.sharedInstance()
          try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
          try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

          let request = SFSpeechAudioBufferRecognitionRequest()
          request.shouldReportPartialResults = true
          if recognizer.supportsOnDeviceRecognition && ((options?["preferOffline"] as? Bool) ?? true) {
            request.requiresOnDeviceRecognition = true
          }
          self.recognitionRequest = request

          let inputNode = self.audioEngine.inputNode
          let format = inputNode.outputFormat(forBus: 0)
          inputNode.removeTap(onBus: 0)
          inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self = self, self.activeSessionId == sessionId, self.isListening else { return }
            request.append(buffer)
            let level = Self.computeBufferLevel(buffer)
            self.sendEvent("onSpeechVolume", ["level": level, "sessionId": sessionId])
          }

          self.audioEngine.prepare()
          try self.audioEngine.start()
          self.isListening = true
          self.sendEvent("onSpeechState", ["state": "listening", "sessionId": sessionId])

          self.recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self, self.activeSessionId == sessionId else { return }
            if let result = result {
              let transcript = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
              if !transcript.isEmpty {
                if result.isFinal {
                  self.sendEvent("onSpeechResult", ["text": transcript, "sessionId": sessionId])
                } else {
                  self.sendEvent("onSpeechPartial", ["text": transcript, "sessionId": sessionId])
                }
              }
              if result.isFinal {
                self.teardown(emitEnded: true)
              }
            }
            if let error = error {
              if self.isListening {
                self.sendEvent("onSpeechError", [
                  "code": (error as NSError).code,
                  "message": error.localizedDescription,
                  "recoverable": true,
                  "sessionId": sessionId
                ])
              }
              self.teardown(emitEnded: true)
            }
          }

          promise.resolve(["sessionId": sessionId])
        } catch {
          self.teardown(emitEnded: false)
          promise.reject("E_START_FAILED", error.localizedDescription)
        }
      }
    }

    AsyncFunction("stopListeningAsync") { (promise: Promise) in
      DispatchQueue.main.async {
        self.isListening = false
        self.audioEngine.stop()
        self.audioEngine.inputNode.removeTap(onBus: 0)
        self.recognitionRequest?.endAudio()
        promise.resolve(nil)
      }
    }

    AsyncFunction("cancelListeningAsync") { (promise: Promise) in
      DispatchQueue.main.async {
        self.teardown(emitEnded: true)
        promise.resolve(nil)
      }
    }

    OnDestroy {
      DispatchQueue.main.async {
        self.teardown(emitEnded: false)
      }
    }
  }

  private func teardown(emitEnded: Bool) {
    let endedSession = activeSessionId
    isListening = false
    if audioEngine.isRunning {
      audioEngine.stop()
    }
    audioEngine.inputNode.removeTap(onBus: 0)
    recognitionRequest?.endAudio()
    recognitionRequest = nil
    recognitionTask?.cancel()
    recognitionTask = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    if emitEnded && endedSession > 0 {
      activeSessionId = sessionCounter + 1
      sendEvent("onSpeechState", ["state": "ended", "sessionId": endedSession])
    }
  }

  private static func computeBufferLevel(_ buffer: AVAudioPCMBuffer) -> Double {
    guard let channelData = buffer.floatChannelData?[0] else { return 0 }
    let frameLength = Int(buffer.frameLength)
    if frameLength <= 0 { return 0 }
    var sum: Float = 0
    for i in 0..<frameLength {
      let sample = channelData[i]
      sum += sample * sample
    }
    let rms = sqrt(sum / Float(frameLength))
    let db = 20 * log10(max(rms, 0.00001))
    return Double(min(max((db + 50) / 45, 0), 1))
  }
}
