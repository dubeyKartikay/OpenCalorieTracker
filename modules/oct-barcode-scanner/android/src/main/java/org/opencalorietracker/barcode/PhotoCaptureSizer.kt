package org.opencalorietracker.barcode

import kotlin.math.max
import kotlin.math.roundToInt

/** Pure JVM helper for bounding captured meal photos without upscaling. */
object PhotoCaptureSizer {
  fun computeScaledSize(width: Int, height: Int, maxDimension: Int = 1600): Pair<Int, Int> {
    if (width <= 0 || height <= 0 || maxDimension <= 0) return Pair(0, 0)
    val longest = max(width, height)
    if (longest <= maxDimension) return Pair(width, height)
    val scale = maxDimension.toDouble() / longest.toDouble()
    val scaledWidth = max(1, (width * scale).roundToInt())
    val scaledHeight = max(1, (height * scale).roundToInt())
    return Pair(scaledWidth, scaledHeight)
  }
}
