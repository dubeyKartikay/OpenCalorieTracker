package org.opencalorietracker.health

import androidx.health.connect.client.records.MealType
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.units.Mass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class HealthRecordMapperTest {
  private fun payload(): Map<String, Any?> = mapOf(
    "entryId" to "entry-123", "occurredAt" to "2026-11-23T08:30:00Z",
    "foodName" to "Oats", "meal" to "Breakfast", "kcal" to 420.0,
    "proteinG" to 20.0, "carbsG" to 55.0, "fatG" to 12.0,
  )

  @Test fun `energy uses kilocalories and macronutrients use grams`() {
    val record = HealthRecordMapper.nutritionRecord(payload(), 1234L)
    assertEquals(420.0, record.energy!!.inKilocalories, 0.000001)
    assertEquals(420000.0, record.energy!!.inCalories, 0.000001)
    assertEquals(20.0, record.protein!!.inGrams, 0.000001)
    assertEquals(55.0, record.totalCarbohydrate!!.inGrams, 0.000001)
    assertEquals(12.0, record.totalFat!!.inGrams, 0.000001)
  }

  @Test fun `absent and explicit null optional nutrients stay null`() {
    for (values in listOf(payload(), payload() + mapOf(
      "fiberG" to null, "sugarG" to null, "satFatG" to null, "sodiumMg" to null,
      "calciumMg" to null, "ironMg" to null, "potassiumMg" to null,
    ))) {
      val record = HealthRecordMapper.nutritionRecord(values, 1L)
      assertNull(record.dietaryFiber)
      assertNull(record.sugar)
      assertNull(record.saturatedFat)
      assertNull(record.sodium)
      assertNull(record.calcium)
      assertNull(record.iron)
      assertNull(record.potassium)
    }
  }

  @Test fun `known optional nutrients preserve units and explicit zero`() {
    val record = HealthRecordMapper.nutritionRecord(payload() + mapOf(
      "fiberG" to 5.0, "sugarG" to 0.0, "satFatG" to 2.0, "sodiumMg" to 350.0,
      "calciumMg" to 120.0, "ironMg" to 3.5, "potassiumMg" to 420.0,
    ), 1L)
    assertEquals(5.0, record.dietaryFiber!!.inGrams, 0.000001)
    assertEquals(0.0, record.sugar!!.inGrams, 0.000001)
    assertEquals(2.0, record.saturatedFat!!.inGrams, 0.000001)
    assertEquals(350.0, record.sodium!!.inMilligrams, 0.000001)
    assertEquals(120.0, record.calcium!!.inMilligrams, 0.000001)
    assertEquals(3.5, record.iron!!.inMilligrams, 0.000001)
    assertEquals(420.0, record.potassium!!.inMilligrams, 0.000001)
  }

  @Test fun `meal names map to Health Connect meal types`() {
    for ((name, expected) in mapOf(
      "Breakfast" to MealType.MEAL_TYPE_BREAKFAST, "Lunch" to MealType.MEAL_TYPE_LUNCH,
      "Snack" to MealType.MEAL_TYPE_SNACK, "Dinner" to MealType.MEAL_TYPE_DINNER,
      "Other" to MealType.MEAL_TYPE_UNKNOWN,
    )) assertEquals(expected, HealthRecordMapper.mealType(name))
  }

  @Test fun `stable client ID and increasing version enable edit propagation`() {
    val original = HealthRecordMapper.nutritionRecord(payload(), 1000L)
    val edited = HealthRecordMapper.nutritionRecord(payload() + ("kcal" to 500.0), 1001L)
    assertEquals("entry-123", original.metadata.clientRecordId)
    assertEquals(original.metadata.clientRecordId, edited.metadata.clientRecordId)
    assertEquals(1001L, edited.metadata.clientRecordVersion)
    assertEquals(Metadata.RECORDING_METHOD_MANUAL_ENTRY, edited.metadata.recordingMethod)
    assertEquals(Instant.parse("2026-11-23T08:30:00Z"), original.startTime)
    assertEquals(original.startTime.plusSeconds(1), original.endTime)
    assertEquals(ZoneId.systemDefault().rules.getOffset(original.startTime), original.startZoneOffset)
    assertEquals(original.startZoneOffset, original.endZoneOffset)
  }

  @Test fun `weight mapping preserves provider identity and local date`() {
    // Service-populated fields have no public factory in connect-client 1.1.0.
    // Construct a read-result fixture via reflection, never in production code.
    val constructor = Metadata::class.java.getDeclaredConstructor(
      Int::class.javaPrimitiveType, String::class.java, DataOrigin::class.java,
      Instant::class.java, String::class.java, Long::class.javaPrimitiveType, Device::class.java,
    ).apply { isAccessible = true }
    val metadata = constructor.newInstance(
      Metadata.RECORDING_METHOD_MANUAL_ENTRY, "provider-weight-id", DataOrigin("com.scale.app"),
      Instant.EPOCH, null, 0L, null,
    )
    val record = WeightRecord(
      time = Instant.parse("2026-11-23T23:30:00Z"), zoneOffset = null,
      weight = Mass.kilograms(72.4), metadata = metadata,
    )
    val mapped = HealthRecordMapper.weightSample(record, ZoneId.of("Asia/Kolkata"))
    assertEquals("provider-weight-id", mapped["externalId"])
    assertEquals("2026-11-24", mapped["date"])
    assertEquals("2026-11-23T23:30:00Z", mapped["measuredAt"])
    assertEquals(72.4, mapped["weightKg"] as Double, 0.000001)
    assertEquals("com.scale.app", mapped["sourceAppId"])
  }
}
