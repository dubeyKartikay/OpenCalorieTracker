package org.opencalorietracker.health

import android.content.Context
import android.content.Intent
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.Serializable
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.util.concurrent.atomic.AtomicLong

class OctHealthModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React application context is unavailable" }
  private val nutritionPermission = HealthPermission.getWritePermission(NutritionRecord::class)
  private val weightPermission = HealthPermission.getReadPermission(WeightRecord::class)
  private lateinit var permissionLauncher: AppContextActivityResultLauncher<HealthPermissionRequest, Set<String>>
  private val permissionMutex = Mutex()
  private val lastVersion = AtomicLong(0)

  private fun client(): HealthConnectClient {
    check(HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE) {
      "Health Connect is unavailable. Install or update Health Connect on a supported device."
    }
    return HealthConnectClient.getOrCreate(context)
  }

  override fun definition() = ModuleDefinition {
    Name("OctHealth")

    Function("getCapability") {
      val status = HealthConnectClient.getSdkStatus(context)
      mapOf(
        "platform" to "health_connect",
        "available" to (status == HealthConnectClient.SDK_AVAILABLE),
        "label" to "Health Connect",
        "description" to when (status) {
          HealthConnectClient.SDK_AVAILABLE -> "Health Connect is available. Access depends on the permissions you grant."
          HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "Install or update Health Connect to connect your health data."
          else -> "Health Connect is unavailable on this device or Android profile."
        },
      )
    }

    AsyncFunction("getPermissionsAsync") Coroutine { ->
      if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) {
        permissionState(emptySet())
      } else {
        permissionState(client().permissionController.getGrantedPermissions())
      }
    }

    AsyncFunction("requestPermissionsAsync") Coroutine { scopes: List<String> ->
      permissionMutex.withLock {
        val client = client()
        val permissions = scopes.map { scope ->
          when (scope) {
            "nutrition_write" -> nutritionPermission
            "weight_read" -> weightPermission
            else -> throw IllegalArgumentException("Unknown health permission: $scope")
          }
        }.toSet()
        if (permissions.isNotEmpty()) {
          permissionLauncher.launch(HealthPermissionRequest(ArrayList(permissions)))
        }
        // Re-query includes previously granted scopes and reflects revocations.
        permissionState(client.permissionController.getGrantedPermissions())
      }
    }

    AsyncFunction("writeNutritionAsync") Coroutine { payload: Map<String, Any?>, existingExternalId: String? ->
      // Health Connect upserts by clientRecordId, regardless of the external UUID.
      // Ensure two edits in the same millisecond still have increasing versions.
      val version = lastVersion.updateAndGet { previous -> maxOf(System.currentTimeMillis(), previous + 1) }
      val record = HealthRecordMapper.nutritionRecord(payload, version)
      val response = client().insertRecords(listOf(record))
      mapOf("externalRecordId" to (response.recordIdsList.firstOrNull()
        ?: existingExternalId ?: requireNotNull(record.metadata.clientRecordId)))
    }

    AsyncFunction("deleteNutritionAsync") Coroutine { externalRecordId: String ->
      client().deleteRecords(
        NutritionRecord::class,
        recordIdsList = listOf(externalRecordId),
        clientRecordIdsList = emptyList(),
      )
    }

    AsyncFunction("readWeightSamplesAsync") Coroutine { sinceIsoDate: String? ->
      val client = client()
      val end = Instant.now()
      val start = when {
        sinceIsoDate == null -> end.minus(30, ChronoUnit.DAYS)
        sinceIsoDate.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) ->
          LocalDate.parse(sinceIsoDate).atStartOfDay(ZoneId.systemDefault()).toInstant()
        else -> Instant.parse(sinceIsoDate)
      }
      val samples = mutableListOf<Map<String, Any?>>()
      if (start < end) {
        var pageToken: String? = null
        do {
          val page = client.readRecords(ReadRecordsRequest(
            recordType = WeightRecord::class,
            timeRangeFilter = TimeRangeFilter.between(start, end),
            pageToken = pageToken,
          ))
          samples.addAll(page.records.map { HealthRecordMapper.weightSample(it) })
          pageToken = page.pageToken
        } while (pageToken != null)
      }
      samples
    }

    RegisterActivityContracts {
      permissionLauncher = registerForActivityResult(HealthPermissionsContract()) { _, _ ->
        // If Android destroys the JS caller, the next getPermissionsAsync re-queries the OS.
      }
    }
  }

  private fun permissionState(granted: Set<String>): Map<String, Boolean> = mapOf(
    "nutritionWrite" to (nutritionPermission in granted),
    "weightRead" to (weightPermission in granted),
  )
}

private data class HealthPermissionRequest(val permissions: ArrayList<String>) : Serializable

private class HealthPermissionsContract : AppContextActivityResultContract<HealthPermissionRequest, Set<String>> {
  private val delegate = PermissionController.createRequestPermissionResultContract()

  override fun createIntent(context: Context, input: HealthPermissionRequest): Intent =
    delegate.createIntent(context, input.permissions.toSet())

  override fun parseResult(input: HealthPermissionRequest, resultCode: Int, intent: Intent?): Set<String> =
    delegate.parseResult(resultCode, intent)
}
