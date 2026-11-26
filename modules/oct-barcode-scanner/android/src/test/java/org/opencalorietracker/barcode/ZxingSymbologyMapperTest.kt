package org.opencalorietracker.barcode

import org.junit.Assert.*
import org.junit.Test

class ZxingSymbologyMapperTest {
  @Test fun mapsRetailAndNativeEnumNames() {
    val formats = mapOf(
      "EAN13" to "EAN-13", "EAN_13" to "EAN-13", "EAN8" to "EAN-8",
      "UPCA" to "UPC-A", "UPCE" to "UPC-E", "UPC_A" to "UPC-A", "UPC_E" to "UPC-E",
      "Code128" to "Code-128", "CODE_128" to "Code-128", "DataBar" to "DataBar",
      "DATA_BAR_OMNI" to "DataBar", "DATA_BAR_EXP_STK" to "DataBar-Expanded",
      "ITF" to "ITF", "ITF_14" to "ITF", "QR_CODE_MODEL_2" to "QR",
      "DATA_MATRIX" to "DataMatrix"
    )
    formats.forEach { (input, expected) -> assertEquals(input, expected, ZxingSymbologyMapper.map(input)) }
  }

  @Test fun rejectsBlankInvalidAndUnknownResultsAndPreservesLeadingZeros() {
    assertNull(ZxingSymbologyMapper.detection("  ", "EAN13"))
    assertNull(ZxingSymbologyMapper.detection(null, "EAN13"))
    assertNull(ZxingSymbologyMapper.detection("123", "EAN13", false))
    assertNull(ZxingSymbologyMapper.detection("123", "NONE"))
    assertNull(ZxingSymbologyMapper.detection("12\u000034", "EAN13"))
    assertEquals("00123456", ZxingSymbologyMapper.detection("00123456", "EAN8")?.rawCode)
  }

  @Test fun debouncesIdenticalCodesButDeliversDifferentCodesImmediately() {
    val debounce = BarcodeDetectionDebouncer()
    val first = ZxingSymbologyMapper.detection("00123456", "EAN8")
    val other = ZxingSymbologyMapper.detection("76543210", "EAN8")
    assertTrue(debounce.accept(first, 0))
    assertFalse(debounce.accept(first, 1_199))
    assertFalse(debounce.accept(null, 1_200))
    assertTrue(debounce.accept(first, 1_200))
    assertTrue(debounce.accept(other, 1_201))
    assertTrue(debounce.accept(first, 1_202))
    assertFalse(debounce.accept(first, 1_203))
    debounce.reset()
    assertTrue(debounce.accept(first, 1_204))
  }
}
