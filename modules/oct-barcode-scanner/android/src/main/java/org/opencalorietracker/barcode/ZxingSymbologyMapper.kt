package org.opencalorietracker.barcode

import java.util.Locale

/** No Android or JNI dependencies: format names work with both ZXing enums and JVM tests. */
object ZxingSymbologyMapper {
  data class Detection(val rawCode: String, val symbology: String) {
    fun asMap(): Map<String, String> = mapOf("rawCode" to rawCode, "symbology" to symbology)
  }

  fun map(formatName: String): String? {
    val name = formatName.replace(Regex("[^A-Za-z0-9]"), "").uppercase(Locale.ROOT)
    return when (name) {
      "EAN13", "ISBN" -> "EAN-13"
      "EAN8" -> "EAN-8"
      "UPCA" -> "UPC-A"
      "UPCE" -> "UPC-E"
      "CODE128" -> "Code-128"
      "CODE39", "CODE39STD", "CODE39EXT" -> "Code-39"
      "CODE93" -> "Code-93"
      "ITF", "ITF14", "INTERLEAVED2OF5" -> "ITF"
      "DATABAR", "DATABAROMNI", "DATABARSTK", "DATABARSTKOMNI", "DATABARLTD" -> "DataBar"
      "DATABAREXP", "DATABAREXPSTK", "DATABAREXPANDED", "DATABAREXPANDEDSTACKED" -> "DataBar-Expanded"
      "QR", "QRCODE", "QRCODEMODEL1", "QRCODEMODEL2" -> "QR"
      "MICROQRCODE" -> "Micro-QR"
      "RMQRCODE" -> "rMQR"
      "DATAMATRIX" -> "DataMatrix"
      "PDF417", "COMPACTPDF417" -> "PDF417"
      "MICROPDF417" -> "Micro-PDF417"
      "AZTEC", "AZTECCODE", "AZTECRUNE" -> "Aztec"
      "CODABAR" -> "Codabar"
      "MAXICODE" -> "MaxiCode"
      "CODE32" -> "Code-32"
      "PZN" -> "PZN"
      "TELEPEN", "TELEPENALPHA", "TELEPENNUMERIC" -> "Telepen"
      else -> null
    }
  }

  fun detection(text: String?, formatName: String, valid: Boolean = true): Detection? {
    if (!valid || text.isNullOrBlank() || text.contains('\u0000') || text.contains('\uFFFD')) return null
    val symbology = map(formatName) ?: return null
    return Detection(text, symbology)
  }
}

/** Cooldown for consecutive identical codes. Different codes are delivered immediately. */
class BarcodeDetectionDebouncer(private val cooldownMillis: Long = 1_200L) {
  private var lastCode: String? = null
  private var lastSeenAt: Long = 0L

  init { require(cooldownMillis >= 0) }

  @Synchronized
  fun accept(detection: ZxingSymbologyMapper.Detection?, nowMillis: Long): Boolean {
    if (detection == null) return false
    val duplicate = detection.rawCode == lastCode && nowMillis >= lastSeenAt && nowMillis - lastSeenAt < cooldownMillis
    lastCode = detection.rawCode
    // Timestamp tracks emissions, so a stationary code can be detected again after the cooldown.
    if (!duplicate) lastSeenAt = nowMillis
    return !duplicate
  }

  @Synchronized
  fun reset() { lastCode = null; lastSeenAt = 0L }
}
