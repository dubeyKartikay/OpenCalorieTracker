package org.opencalorietracker.speech

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger

class OctSpeechModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val sessionCounter = AtomicInteger(0)
  private var recognizer: SpeechRecognizer? = null
  private var activeSessionId: Int = 0
  private var isListening: Boolean = false
  private var userStoppedSessionId: Int = 0
  private var stopTimeoutRunnable: Runnable? = null

  private fun requireContext(): Context =
    appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun isStandardAvailable(context: Context): Boolean =
    SpeechRecognizer.isRecognitionAvailable(context)

  private fun isOnDeviceAvailable(context: Context): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

  private fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block()
    else mainHandler.post(block)
  }

  private fun clearStopTimeoutLocked() {
    val runnable = stopTimeoutRunnable
    stopTimeoutRunnable = null
    if (runnable != null) {
      mainHandler.removeCallbacks(runnable)
    }
  }

  private fun destroyRecognizerLocked() {
    clearStopTimeoutLocked()
    isListening = false
    val current = recognizer
    recognizer = null
    if (current != null) {
      try {
        current.cancel()
      } catch (_: Throwable) {
      }
      try {
        current.destroy()
      } catch (_: Throwable) {
      }
    }
  }

  private fun emitState(state: String, sessionId: Int) {
    sendEvent("onSpeechState", mapOf("state" to state, "sessionId" to sessionId))
  }

  override fun definition() = ModuleDefinition {
    Name("OctSpeech")

    Events(
      "onSpeechState",
      "onSpeechVolume",
      "onSpeechPartial",
      "onSpeechResult",
      "onSpeechError",
    )

    Function("getCapability") {
      val context = appContext.reactContext
      if (context == null) {
        mapOf(
          "available" to false,
          "onDeviceAvailable" to false,
          "platform" to "android",
          "reason" to "App context unavailable.",
        )
      } else {
        val standard = isStandardAvailable(context)
        val onDevice = isOnDeviceAvailable(context)
        val available = standard || onDevice
        mapOf(
          "available" to available,
          "onDeviceAvailable" to onDevice,
          "platform" to "android",
          "reason" to if (available) null else "No Android speech recognition service is installed on this device.",
        )
      }
    }

    AsyncFunction("getPermissionAsync") {
      val context = requireContext()
      ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    }

    AsyncFunction("requestPermissionAsync") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        Manifest.permission.RECORD_AUDIO,
      )
    }

    AsyncFunction("startListeningAsync") { options: Map<String, Any?>?, promise: Promise ->
      val context = requireContext()
      if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        promise.reject("E_PERMISSION", "Microphone permission is required for voice dictation.", null)
        return@AsyncFunction
      }
      val standard = isStandardAvailable(context)
      val onDevice = isOnDeviceAvailable(context)
      if (!standard && !onDevice) {
        promise.reject("E_UNAVAILABLE", "No Android speech recognition service is available on this device.", null)
        return@AsyncFunction
      }
      val locale = (options?.get("locale") as? String)?.takeIf { it.isNotBlank() }
        ?: Locale.getDefault().toLanguageTag()
      val preferOffline = (options?.get("preferOffline") as? Boolean) == true

      runOnMain {
        try {
          destroyRecognizerLocked()
          val sessionId = sessionCounter.incrementAndGet()
          activeSessionId = sessionId

          val instance = if ((preferOffline || !standard) && onDevice && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
          } else {
            SpeechRecognizer.createSpeechRecognizer(context)
          }
          recognizer = instance
          isListening = true

          instance.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
              if (activeSessionId != sessionId) return
              emitState("listening", sessionId)
            }

            override fun onBeginningOfSpeech() {}

            override fun onRmsChanged(rmsdB: Float) {
              if (activeSessionId != sessionId || !isListening) return
              sendEvent(
                "onSpeechVolume",
                mapOf("level" to SpeechSignalMapper.normalizeRmsDb(rmsdB), "sessionId" to sessionId),
              )
            }

            override fun onBufferReceived(buffer: ByteArray?) {}

            override fun onEndOfSpeech() {
              if (activeSessionId != sessionId) return
              sendEvent("onSpeechVolume", mapOf("level" to 0.0, "sessionId" to sessionId))
            }

            override fun onError(error: Int) {
              if (activeSessionId != sessionId) return
              val stoppedByUser = userStoppedSessionId == sessionId
              destroyRecognizerLocked()
              if (stoppedByUser && (error == SpeechSignalMapper.ERROR_NO_MATCH || error == SpeechSignalMapper.ERROR_SPEECH_TIMEOUT)) {
                emitState("ended", sessionId)
                return
              }
              val mapped = SpeechSignalMapper.mapError(error)
              sendEvent(
                "onSpeechError",
                mapOf(
                  "code" to error,
                  "message" to mapped.message,
                  "recoverable" to mapped.recoverable,
                  "sessionId" to sessionId,
                ),
              )
              emitState("ended", sessionId)
            }

            override fun onResults(results: Bundle?) {
              if (activeSessionId != sessionId) return
              val text = SpeechSignalMapper.pickTranscript(
                results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION),
              )
              destroyRecognizerLocked()
              if (text != null) {
                sendEvent("onSpeechResult", mapOf("text" to text, "sessionId" to sessionId))
              }
              emitState("ended", sessionId)
            }

            override fun onPartialResults(partialResults: Bundle?) {
              if (activeSessionId != sessionId || !isListening) return
              val text = SpeechSignalMapper.pickTranscript(
                partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION),
              ) ?: return
              sendEvent("onSpeechPartial", mapOf("text" to text, "sessionId" to sessionId))
            }

            override fun onEvent(eventType: Int, params: Bundle?) {}
          })

          val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2200L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1800L)
            if (preferOffline) {
              putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            }
          }

          emitState("starting", sessionId)
          instance.startListening(intent)
          promise.resolve(mapOf("sessionId" to sessionId))
        } catch (error: Throwable) {
          destroyRecognizerLocked()
          promise.reject("E_START_FAILED", error.message ?: "Could not start voice dictation.", error)
        }
      }
    }

    AsyncFunction("stopListeningAsync") { targetSessionId: Int?, promise: Promise ->
      runOnMain {
        val current = recognizer
        val sessionId = activeSessionId
        if (targetSessionId != null && targetSessionId > 0 && sessionId != targetSessionId) {
          promise.resolve(null)
          return@runOnMain
        }
        if (current != null && isListening) {
          isListening = false
          userStoppedSessionId = sessionId
          try {
            current.stopListening()
            clearStopTimeoutLocked()
            val timeout = Runnable {
              if (activeSessionId == sessionId && recognizer != null) {
                destroyRecognizerLocked()
                emitState("ended", sessionId)
              }
            }
            stopTimeoutRunnable = timeout
            mainHandler.postDelayed(timeout, 900L)
          } catch (_: Throwable) {
            destroyRecognizerLocked()
            emitState("ended", sessionId)
          }
        }
        promise.resolve(null)
      }
    }

    AsyncFunction("cancelListeningAsync") { targetSessionId: Int?, promise: Promise ->
      runOnMain {
        val sessionId = activeSessionId
        if (targetSessionId != null && targetSessionId > 0 && sessionId != targetSessionId) {
          promise.resolve(null)
          return@runOnMain
        }
        activeSessionId = sessionCounter.incrementAndGet()
        destroyRecognizerLocked()
        emitState("ended", sessionId)
        promise.resolve(null)
      }
    }

    OnActivityEntersBackground {
      runOnMain {
        if (recognizer != null) {
          val sessionId = activeSessionId
          activeSessionId = sessionCounter.incrementAndGet()
          destroyRecognizerLocked()
          emitState("ended", sessionId)
        }
      }
    }

    OnDestroy {
      runOnMain {
        activeSessionId = sessionCounter.incrementAndGet()
        destroyRecognizerLocked()
      }
    }
  }
}
