const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withEntitlementsPlist,
  withInfoPlist,
} = require('@expo/config-plugins');

const HEALTH_PACKAGE = 'com.google.android.apps.healthdata';
const RATIONALE_ACTION = 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE';
const USAGE_ACTION = 'android.intent.action.VIEW_PERMISSION_USAGE';
const HEALTH_CATEGORY = 'android.intent.category.HEALTH_PERMISSIONS';

function ensureIntentFilter(activity, action, category) {
  const filters = activity['intent-filter'] ??= [];
  if (!filters.some(filter =>
    filter.action?.some(item => item.$['android:name'] === action) &&
    (!category || filter.category?.some(item => item.$['android:name'] === category)))) {
    filters.push({
      action: [{ $: { 'android:name': action } }],
      ...(category ? { category: [{ $: { 'android:name': category } }] } : {}),
    });
  }
}

function withOctHealth(config) {
  config = withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest;
    const permissions = manifest['uses-permission'] ??= [];
    for (const name of ['android.permission.health.WRITE_NUTRITION', 'android.permission.health.READ_WEIGHT']) {
      if (!permissions.some(permission => permission.$['android:name'] === name)) {
        permissions.push({ $: { 'android:name': name } });
      }
    }
    const queries = manifest.queries ??= [];
    if (!queries.some(query => query.package?.some(item => item.$['android:name'] === HEALTH_PACKAGE))) {
      queries.push({ package: [{ $: { 'android:name': HEALTH_PACKAGE } }] });
    }
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    mainActivity.$['android:exported'] = 'true';
    ensureIntentFilter(mainActivity, RATIONALE_ACTION);
    ensureIntentFilter(mainActivity, USAGE_ACTION, HEALTH_CATEGORY);

    // Android 14+ discovers the rationale through this protected alias. Keep the
    // permission on the alias, since putting it on MainActivity blocks app launch.
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    const aliases = application['activity-alias'] ??= [];
    const aliasName = 'org.opencalorietracker.health.OctHealthPermissionUsageActivity';
    let alias = aliases.find(item => item.$?.['android:name'] === aliasName);
    if (!alias) {
      alias = { $: { 'android:name': aliasName } };
      aliases.push(alias);
    }
    Object.assign(alias.$, {
      'android:targetActivity': mainActivity.$['android:name'],
      'android:exported': 'true',
      'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE',
    });
    ensureIntentFilter(alias, USAGE_ACTION, HEALTH_CATEGORY);
    return mod;
  });
  config = withInfoPlist(config, mod => {
    mod.modResults.NSHealthShareUsageDescription ??= 'OpenCalorieTracker reads your weight from Apple Health when you enable weight import.';
    mod.modResults.NSHealthUpdateUsageDescription ??= 'OpenCalorieTracker saves your food and nutrition entries to Apple Health when you enable nutrition sync.';
    return mod;
  });
  return withEntitlementsPlist(config, mod => {
    mod.modResults['com.apple.developer.healthkit'] = true;
    return mod;
  });
}

module.exports = createRunOncePlugin(withOctHealth, 'oct-health', '0.1.0');
