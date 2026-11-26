package org.opencalorietracker.health

import androidx.health.connect.client.records.MealType
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.units.Energy
import androidx.health.connect.client.units.Mass
import java.time.Instant
import java.time.ZoneId

/** No Android context or service is needed to map records; usable in JVM tests. */
internal object HealthRecordMapper {
  fun mealType(meal: String): Int = when (meal) {
    "Breakfast" -> MealType.MEAL_TYPE_BREAKFAST
    "Lunch" -> MealType.MEAL_TYPE_LUNCH
    "Snack" -> MealType.MEAL_TYPE_SNACK
    "Dinner" -> MealType.MEAL_TYPE_DINNER
    else -> MealType.MEAL_TYPE_UNKNOWN
  }

  fun nutritionRecord(payload: Map<String, Any?>, versionMs: Long): NutritionRecord {
    val start = Instant.parse(payload.requiredString("occurredAt"))
    val offset = ZoneId.systemDefault().rules.getOffset(start)
    return NutritionRecord(
      startTime = start,
      endTime = start.plusSeconds(1),
      startZoneOffset = offset,
      endZoneOffset = offset,
      metadata = Metadata.manualEntry(
        clientRecordId = payload.requiredString("entryId"),
        clientRecordVersion = versionMs,
      ),
      name = payload.requiredString("foodName"),
      mealType = mealType(payload.requiredString("meal")),
      energy = Energy.kilocalories(payload.requiredNumber("kcal")),
      protein = Mass.grams(payload.requiredNumber("proteinG")),
      totalCarbohydrate = Mass.grams(payload.requiredNumber("carbsG")),
      totalFat = Mass.grams(payload.requiredNumber("fatG")),
      dietaryFiber = payload.optionalNumber("fiberG")?.let { Mass.grams(it) },
      sugar = payload.optionalNumber("sugarG")?.let { Mass.grams(it) },
      saturatedFat = payload.optionalNumber("satFatG")?.let { Mass.grams(it) },
      sodium = payload.optionalNumber("sodiumMg")?.let { Mass.milligrams(it) },
      calcium = payload.optionalNumber("calciumMg")?.let { Mass.milligrams(it) },
      iron = payload.optionalNumber("ironMg")?.let { Mass.milligrams(it) },
      potassium = payload.optionalNumber("potassiumMg")?.let { Mass.milligrams(it) },
    )
  }

  fun weightSample(record: WeightRecord, zone: ZoneId = ZoneId.systemDefault()): Map<String, Any?> = mapOf(
    "externalId" to record.metadata.id,
    "date" to record.time.atZone(zone).toLocalDate().toString(),
    "measuredAt" to record.time.toString(),
    "weightKg" to record.weight.inKilograms,
    "sourceAppId" to record.metadata.dataOrigin.packageName,
  )

  private fun Map<String, Any?>.requiredString(key: String): String =
    (this[key] as? String)?.takeIf { it.isNotBlank() }
      ?: throw IllegalArgumentException("$key must be a nonempty string")

  private fun Map<String, Any?>.requiredNumber(key: String): Double =
    optionalNumber(key) ?: throw IllegalArgumentException("$key is required")

  private fun Map<String, Any?>.optionalNumber(key: String): Double? {
    val value = this[key] ?: return null
    val number = (value as? Number)?.toDouble()
      ?: throw IllegalArgumentException("$key must be a number")
    require(number.isFinite() && number >= 0) { "$key must be finite and nonnegative" }
    return number
  }
}
