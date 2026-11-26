const { AndroidConfig, withAndroidManifest, withInfoPlist, createRunOncePlugin } = require('@expo/config-plugins');

function withOctBarcodeScanner(config) {
  config = AndroidConfig.Permissions.withPermissions(config, ['android.permission.CAMERA']);
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const features = manifest['uses-feature'] || [];
    const cameraFeature = features.find((feature) => feature.$?.['android:name'] === 'android.hardware.camera');
    if (cameraFeature) {
      cameraFeature.$['android:required'] = 'false';
    } else {
      features.push({ $: { 'android:name': 'android.hardware.camera', 'android:required': 'false' } });
    }
    manifest['uses-feature'] = features;
    return mod;
  });
  return withInfoPlist(config, (mod) => {
    if (!mod.modResults.NSCameraUsageDescription) {
      mod.modResults.NSCameraUsageDescription = 'Allow OpenCalorieTracker to scan food barcodes with your camera.';
    }
    return mod;
  });
}

module.exports = createRunOncePlugin(withOctBarcodeScanner, 'oct-barcode-scanner', '0.1.0');
