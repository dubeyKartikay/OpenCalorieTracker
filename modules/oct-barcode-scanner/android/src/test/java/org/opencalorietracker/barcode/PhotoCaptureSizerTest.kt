package org.opencalorietracker.barcode

import org.junit.Assert.assertEquals
import org.junit.Test

class PhotoCaptureSizerTest {
  @Test
  fun leavesSmallImagesUnchanged() {
    assertEquals(Pair(1200, 900), PhotoCaptureSizer.computeScaledSize(1200, 900, 1600))
  }

  @Test
  fun downscalesLandscapeAndPortraitProportionally() {
    assertEquals(Pair(1600, 1200), PhotoCaptureSizer.computeScaledSize(4000, 3000, 1600))
    assertEquals(Pair(900, 1600), PhotoCaptureSizer.computeScaledSize(1800, 3200, 1600))
  }

  @Test
  fun handlesNonPositiveDimensionsSafely() {
    assertEquals(Pair(0, 0), PhotoCaptureSizer.computeScaledSize(0, 1080, 1600))
    assertEquals(Pair(0, 0), PhotoCaptureSizer.computeScaledSize(1080, -1, 1600))
  }
}
