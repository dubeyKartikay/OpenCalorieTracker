import ExpoModulesCore
import CoreFoundation
import Foundation
import HealthKit

public final class OctHealthModule: Module {
  private let store = HKHealthStore()
  private let versionLock = NSLock()
  private var lastVersion: Int64 = 0

  // Request authorization for the quantities, not HKCorrelationType.food.
  private static let nutrients: [(key: String, identifier: HKQuantityTypeIdentifier, unit: HKUnit, required: Bool)] = [
    ("kcal", .dietaryEnergyConsumed, .kilocalorie(), true),
    ("proteinG", .dietaryProtein, .gram(), true),
    ("carbsG", .dietaryCarbohydrates, .gram(), true),
    ("fatG", .dietaryFatTotal, .gram(), true),
    ("fiberG", .dietaryFiber, .gram(), false),
    ("sugarG", .dietarySugar, .gram(), false),
    ("satFatG", .dietaryFatSaturated, .gram(), false),
    ("sodiumMg", .dietarySodium, .gramUnit(with: .milli), false),
    ("calciumMg", .dietaryCalcium, .gramUnit(with: .milli), false),
    ("ironMg", .dietaryIron, .gramUnit(with: .milli), false),
    ("potassiumMg", .dietaryPotassium, .gramUnit(with: .milli), false),
  ]

  public func definition() -> ModuleDefinition {
    Name("OctHealth")

    Function("getCapability") { () -> [String: Any] in
      let available = HKHealthStore.isHealthDataAvailable()
      return [
        "platform": "apple_health", "available": available, "label": "Apple Health",
        "description": available
          ? "Apple Health is available. Weight read access is confirmed only when HealthKit returns a weight sample from another app; HealthKit hides denied read permissions."
          : "Apple Health is unavailable on this device.",
      ]
    }

    AsyncFunction("getPermissionsAsync") { (promise: Promise) in
      self.permissions(promise)
    }

    AsyncFunction("requestPermissionsAsync") { (scopes: [String], promise: Promise) in
      guard HKHealthStore.isHealthDataAvailable() else {
        promise.resolve(["nutritionWrite": false, "weightRead": false])
        return
      }
      guard scopes.allSatisfy({ ["nutrition_write", "weight_read"].contains($0) }) else {
        promise.reject("ERR_HEALTH_SCOPE", "Unknown health permission scope")
        return
      }
      var share = Set<HKSampleType>()
      var read = Set<HKObjectType>()
      if scopes.contains("nutrition_write") {
        for nutrient in Self.nutrients {
          if let type = HKObjectType.quantityType(forIdentifier: nutrient.identifier) { share.insert(type) }
        }
      }
      if scopes.contains("weight_read"), let weight = HKObjectType.quantityType(forIdentifier: .bodyMass) {
        read.insert(weight)
      }
      guard !share.isEmpty || !read.isEmpty else {
        self.permissions(promise)
        return
      }
      self.store.requestAuthorization(toShare: share, read: read) { success, error in
        if let error = error { promise.reject(error); return }
        guard success else {
          promise.reject("ERR_HEALTH_AUTHORIZATION", "HealthKit could not complete the authorization request")
          return
        }
        // 'success' means the prompt completed, not that read access was granted.
        self.permissions(promise)
      }
    }.runOnQueue(.main)

    AsyncFunction("writeNutritionAsync") { (payload: [String: Any], existingExternalId: String?, promise: Promise) in
      do {
        try self.ensureAvailable()
        let entryId = try self.requiredString(payload, "entryId")
        let start = try self.instant(self.requiredString(payload, "occurredAt"))
        let foodName = try self.requiredString(payload, "foodName")
        let meal = try self.requiredString(payload, "meal")
        guard let foodType = HKObjectType.correlationType(forIdentifier: .food) else {
          throw self.failure("Food correlations are unavailable")
        }
        let end = start.addingTimeInterval(1)
        let version = self.nextVersion()
        let metadata: [String: Any] = [
          HKMetadataKeySyncIdentifier: entryId,
          HKMetadataKeySyncVersion: NSNumber(value: version),
          HKMetadataKeyFoodType: foodName,
          HKMetadataKeyWasUserEntered: true,
          "org.opencalorietracker.meal": meal,
        ]
        var samples = Set<HKSample>()
        for nutrient in Self.nutrients {
          guard let value = try self.number(payload, nutrient.key, required: nutrient.required) else { continue }
          guard let type = HKObjectType.quantityType(forIdentifier: nutrient.identifier) else {
            throw self.failure("Unsupported nutrient: \(nutrient.key)")
          }
          guard self.store.authorizationStatus(for: type) == .sharingAuthorized else {
            throw self.failure("Apple Health write permission is required for \(nutrient.key)")
          }
          var sampleMetadata = metadata
          // Each quantity needs a distinct, stable sync ID as well as the parent.
          sampleMetadata[HKMetadataKeySyncIdentifier] = "\(entryId):\(nutrient.key)"
          samples.insert(HKQuantitySample(
            type: type, quantity: HKQuantity(unit: nutrient.unit, doubleValue: value),
            start: start, end: end, metadata: sampleMetadata
          ))
        }
        let correlation = HKCorrelation(type: foodType, start: start, end: end, objects: samples, metadata: metadata)
        var predicates = [HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeySyncIdentifier, allowedValues: [entryId])]
        if let externalId = existingExternalId, let uuid = UUID(uuidString: externalId) {
          predicates.append(HKQuery.predicateForObject(with: uuid))
        }
        let ownEntry = NSCompoundPredicate(andPredicateWithSubpredicates: [
          NSCompoundPredicate(orPredicateWithSubpredicates: predicates),
          HKQuery.predicateForObjects(from: HKSource.default()),
        ])
        self.query(foodType, predicate: ownEntry) { previous, error in
          if let error = error { promise.reject(error); return }
          // Sync IDs replace present nutrients. Explicitly remove old quantities
          // omitted by an edit, since deleting a correlation leaves its quantities.
          let presentTypes = Set(samples.map { $0.sampleType.identifier })
          var obsolete: [HKObject] = []
          for old in (previous ?? []).compactMap({ $0 as? HKCorrelation }) {
            obsolete.append(contentsOf: old.objects.filter { !presentTypes.contains($0.sampleType.identifier) })
          }
          self.store.save(correlation) { success, error in
            if let error = error { promise.reject(error); return }
            guard success else { promise.reject("ERR_HEALTH_WRITE", "HealthKit could not save nutrition"); return }
            if obsolete.isEmpty {
              promise.resolve(["externalRecordId": correlation.uuid.uuidString])
            } else {
              self.store.delete(obsolete) { deleted, error in
                if let error = error { promise.reject(error); return }
                guard deleted else { promise.reject("ERR_HEALTH_DELETE", "HealthKit could not remove obsolete nutrients"); return }
                promise.resolve(["externalRecordId": correlation.uuid.uuidString])
              }
            }
          }
        }
      } catch { promise.reject(error) }
    }

    AsyncFunction("deleteNutritionAsync") { (externalRecordId: String, promise: Promise) in
      do {
        try self.ensureAvailable()
        guard let uuid = UUID(uuidString: externalRecordId),
              let type = HKObjectType.correlationType(forIdentifier: .food) else {
          throw self.failure("Invalid nutrition record ID")
        }
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
          HKQuery.predicateForObject(with: uuid),
          HKQuery.predicateForObjects(from: HKSource.default()),
        ])
        self.query(type, predicate: predicate) { records, error in
          if let error = error { promise.reject(error); return }
          var objects = Set<HKObject>()
          for correlation in (records ?? []).compactMap({ $0 as? HKCorrelation }) {
            objects.insert(correlation)
            objects.formUnion(correlation.objects)
          }
          guard !objects.isEmpty else { promise.resolve(); return }
          self.store.delete(Array(objects)) { success, error in
            if let error = error { promise.reject(error); return }
            guard success else { promise.reject("ERR_HEALTH_DELETE", "HealthKit could not delete nutrition"); return }
            promise.resolve()
          }
        }
      } catch { promise.reject(error) }
    }

    AsyncFunction("readWeightSamplesAsync") { (sinceIsoDate: String?, promise: Promise) in
      do {
        try self.ensureAvailable()
        guard let weight = HKObjectType.quantityType(forIdentifier: .bodyMass) else {
          throw self.failure("Body mass samples are unavailable")
        }
        let since = try sinceIsoDate.map { try self.sinceDate($0) } ?? Date.distantPast
        let predicate = HKQuery.predicateForSamples(withStart: since, end: nil, options: .strictStartDate)
        self.query(weight, predicate: predicate, sort: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]) { records, error in
          if let error = error { promise.reject(error); return }
          let date = DateFormatter()
          date.locale = Locale(identifier: "en_US_POSIX")
          date.calendar = Calendar(identifier: .gregorian)
          date.timeZone = .current
          date.dateFormat = "yyyy-MM-dd"
          let iso = ISO8601DateFormatter()
          iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
          let samples: [[String: Any]] = (records ?? []).compactMap { record in
            guard let sample = record as? HKQuantitySample else { return nil }
            return [
              "externalId": sample.uuid.uuidString,
              "date": date.string(from: sample.startDate),
              "measuredAt": iso.string(from: sample.startDate),
              "weightKg": sample.quantity.doubleValue(for: .gramUnit(with: .kilo)),
              "sourceAppId": sample.sourceRevision.source.bundleIdentifier,
            ]
          }
          promise.resolve(samples)
        }
      } catch { promise.reject(error) }
    }
  }

  private func permissions(_ promise: Promise) {
    guard HKHealthStore.isHealthDataAvailable() else {
      promise.resolve(["nutritionWrite": false, "weightRead": false])
      return
    }
    let nutritionWrite = Self.nutrients.allSatisfy { nutrient in
      guard let type = HKObjectType.quantityType(forIdentifier: nutrient.identifier) else { return false }
      return store.authorizationStatus(for: type) == .sharingAuthorized
    }
    guard let weight = HKObjectType.quantityType(forIdentifier: .bodyMass) else {
      promise.resolve(["nutritionWrite": nutritionWrite, "weightRead": false])
      return
    }
    // HealthKit does not expose read authorization. A query that returns another
    // source's sample is affirmative evidence; an empty result is indeterminate.
    // Exclude our own samples, which are visible even without read permission.
    let external = NSCompoundPredicate(notPredicateWithSubpredicate: HKQuery.predicateForObjects(from: HKSource.default()))
    query(weight, predicate: external, limit: 1) { records, _ in
      promise.resolve(["nutritionWrite": nutritionWrite, "weightRead": !(records ?? []).isEmpty])
    }
  }

  private func query(
    _ type: HKSampleType, predicate: NSPredicate?, limit: Int = HKObjectQueryNoLimit,
    sort: [NSSortDescriptor]? = nil, completion: @escaping ([HKSample]?, Error?) -> Void
  ) {
    store.execute(HKSampleQuery(sampleType: type, predicate: predicate, limit: limit, sortDescriptors: sort) { _, samples, error in
      completion(samples, error)
    })
  }

  private func nextVersion() -> Int64 {
    versionLock.lock()
    defer { versionLock.unlock() }
    lastVersion = max(Int64(Date().timeIntervalSince1970 * 1000), lastVersion + 1)
    return lastVersion
  }

  private func ensureAvailable() throws {
    guard HKHealthStore.isHealthDataAvailable() else { throw failure("Apple Health is unavailable on this device") }
  }

  private func requiredString(_ payload: [String: Any], _ key: String) throws -> String {
    guard let value = payload[key] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw failure("\(key) must be a nonempty string")
    }
    return value
  }

  private func number(_ payload: [String: Any], _ key: String, required: Bool) throws -> Double? {
    guard let raw = payload[key], !(raw is NSNull) else {
      if required { throw failure("\(key) is required") }
      return nil
    }
    guard let value = raw as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(),
          value.doubleValue.isFinite, value.doubleValue >= 0 else {
      throw failure("\(key) must be finite and nonnegative")
    }
    return value.doubleValue
  }

  private func instant(_ value: String) throws -> Date {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    guard let date = formatter.date(from: value) else { throw failure("Invalid ISO timestamp: \(value)") }
    return date
  }

  private func sinceDate(_ value: String) throws -> Date {
    if value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil {
      let formatter = DateFormatter()
      formatter.locale = Locale(identifier: "en_US_POSIX")
      formatter.calendar = Calendar(identifier: .gregorian)
      formatter.timeZone = .current
      formatter.dateFormat = "yyyy-MM-dd"
      formatter.isLenient = false
      guard let date = formatter.date(from: value) else { throw failure("Invalid ISO date: \(value)") }
      return date
    }
    return try instant(value)
  }

  private func failure(_ message: String) -> NSError {
    NSError(domain: "OctHealth", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}
