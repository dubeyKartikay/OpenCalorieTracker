package org.opencalorietracker.speech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeechSignalMapperTest {
  @Test
  fun normalizesRmsDbAcrossRangeAndClampsNonFinite() {
    assertEquals(0.0, SpeechSignalMapper.normalizeRmsDb(-5f), 0.0001)
    assertEquals(0.0, SpeechSignalMapper.normalizeRmsDb(-2f), 0.0001)
    assertEquals(0.5, SpeechSignalMapper.normalizeRmsDb(4f), 0.0001)
    assertEquals(1.0, SpeechSignalMapper.normalizeRmsDb(10f), 0.0001)
    assertEquals(1.0, SpeechSignalMapper.normalizeRmsDb(25f), 0.0001)
    assertEquals(0.0, SpeechSignalMapper.normalizeRmsDb(Float.NaN), 0.0001)
    assertEquals(0.0, SpeechSignalMapper.normalizeRmsDb(Float.POSITIVE_INFINITY), 0.0001)
  }

  @Test
  fun picksFirstCleanTranscript() {
    assertNull(SpeechSignalMapper.pickTranscript(null))
    assertNull(SpeechSignalMapper.pickTranscript(listOf("", "   ")))
    assertEquals("2 rotis and dal", SpeechSignalMapper.pickTranscript(listOf("  ", " 2   rotis  and\tdal ")))
  }

  @Test
  fun mapsRecoverableAndPermissionErrors() {
    val noMatch = SpeechSignalMapper.mapError(SpeechSignalMapper.ERROR_NO_MATCH)
    assertTrue(noMatch.recoverable)
    assertTrue(noMatch.message.contains("try again", ignoreCase = true))

    val perm = SpeechSignalMapper.mapError(SpeechSignalMapper.ERROR_INSUFFICIENT_PERMISSIONS)
    assertFalse(perm.recoverable)
    assertTrue(perm.message.contains("permission", ignoreCase = true))
  }
}
