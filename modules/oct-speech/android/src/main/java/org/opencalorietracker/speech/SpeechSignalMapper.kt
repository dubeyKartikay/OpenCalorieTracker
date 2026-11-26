package org.opencalorietracker.speech

/** Pure signal normalization and error mapping for Android SpeechRecognizer. */
object SpeechSignalMapper {
  /** Android SpeechRecognizer error constants mirrored for JVM-only unit tests. */
  const val ERROR_NETWORK_TIMEOUT = 1
  const val ERROR_NETWORK = 2
  const val ERROR_AUDIO = 3
  const val ERROR_SERVER = 4
  const val ERROR_CLIENT = 5
  const val ERROR_SPEECH_TIMEOUT = 6
  const val ERROR_NO_MATCH = 7
  const val ERROR_RECOGNIZER_BUSY = 8
  const val ERROR_INSUFFICIENT_PERMISSIONS = 9
  const val ERROR_TOO_MANY_REQUESTS = 10
  const val ERROR_SERVER_DISCONNECTED = 11
  const val ERROR_LANGUAGE_NOT_SUPPORTED = 12
  const val ERROR_LANGUAGE_UNAVAILABLE = 13

  /** Maps Android onRmsChanged dB values (typically -2..10 dB) into a clamped 0..1 bar level. */
  fun normalizeRmsDb(rmsDb: Float): Double {
    if (!rmsDb.isFinite()) return 0.0
    val clamped = ((rmsDb + 2.0f) / 12.0f).coerceIn(0f, 1f)
    return clamped.toDouble()
  }

  /** Selects the cleanest non-blank transcript candidate from recognizer results. */
  fun pickTranscript(candidates: List<String>?): String? {
    if (candidates == null) return null
    for (item in candidates) {
      val trimmed = item.trim().replace(Regex("\\s+"), " ")
      if (trimmed.isNotEmpty()) return trimmed
    }
    return null
  }

  data class MappedError(val message: String, val recoverable: Boolean)

  fun mapError(code: Int): MappedError = when (code) {
    ERROR_NO_MATCH, ERROR_SPEECH_TIMEOUT ->
      MappedError("Didn't catch that. Tap the mic to try again.", true)
    ERROR_INSUFFICIENT_PERMISSIONS ->
      MappedError("Microphone permission is required for voice dictation.", false)
    ERROR_AUDIO ->
      MappedError("Microphone is busy or unavailable.", false)
    ERROR_RECOGNIZER_BUSY ->
      MappedError("Speech recognizer is busy. Try again in a moment.", true)
    ERROR_NETWORK, ERROR_NETWORK_TIMEOUT, ERROR_SERVER, ERROR_SERVER_DISCONNECTED ->
      MappedError("Speech service could not be reached. Check connection or offline speech pack.", true)
    ERROR_LANGUAGE_NOT_SUPPORTED, ERROR_LANGUAGE_UNAVAILABLE ->
      MappedError("This language isn't available for speech recognition on this device.", false)
    ERROR_TOO_MANY_REQUESTS ->
      MappedError("Speech service rate limit reached. Try again shortly.", true)
    else ->
      MappedError("Voice dictation stopped unexpectedly.", true)
  }
}
