const { AndroidConfig, withAndroidManifest, withInfoPlist, createRunOncePlugin } = require('@expo/config-plugins');

const RECOGNITION_ACTION = 'android.speech.RecognitionService';

function withOctSpeech(config) {
  config = AndroidConfig.Permissions.withPermissions(config, ['android.permission.RECORD_AUDIO']);
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const queries = manifest.queries || [];
    const hasRecognitionQuery = queries.some((query) =>
      Array.isArray(query.intent) &&
      query.intent.some((intent) =>
        Array.isArray(intent.action) &&
        intent.action.some((action) => action.$?.['android:name'] === RECOGNITION_ACTION),
      ),
    );
    if (!hasRecognitionQuery) {
      if (queries.length > 0) {
        queries[0].intent = queries[0].intent || [];
        queries[0].intent.push({ action: [{ $: { 'android:name': RECOGNITION_ACTION } }] });
      } else {
        queries.push({ intent: [{ action: [{ $: { 'android:name': RECOGNITION_ACTION } }] }] });
      }
    }
    manifest.queries = queries;
    return mod;
  });
  return withInfoPlist(config, (mod) => {
    if (!mod.modResults.NSMicrophoneUsageDescription) {
      mod.modResults.NSMicrophoneUsageDescription =
        'Allow OpenCalorieTracker to listen when you dictate a meal.';
    }
    if (!mod.modResults.NSSpeechRecognitionUsageDescription) {
      mod.modResults.NSSpeechRecognitionUsageDescription =
        'Allow OpenCalorieTracker to transcribe dictated meals using on-device speech recognition.';
    }
    return mod;
  });
}

module.exports = createRunOncePlugin(withOctSpeech, 'oct-speech', '0.1.0');
