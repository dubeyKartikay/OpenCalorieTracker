const { withAppBuildGradle, withProjectBuildGradle } = require('@expo/config-plugins');

const PROJECT_MARKER = '// oct-windows-cmake-staging';
const APP_MARKER = '// oct-windows-cmake-app';

const PROJECT_SNIPPET = `
${PROJECT_MARKER}
subprojects { proj ->
  if (System.getProperty('os.name').toLowerCase().contains('windows')) {
    proj.afterEvaluate {
      def androidExt = proj.extensions.findByName('android')
      if (androidExt?.externalNativeBuild?.cmake?.path != null) {
        androidExt.externalNativeBuild.cmake.version = "3.31.4"
        androidExt.externalNativeBuild.cmake.buildStagingDirectory = new File("C:/Users/Public/c/\${proj.name.replace('react-native-', '')}")
      }
    }
  }
}
`;

const APP_DEFAULT_CONFIG_SNIPPET = `        ${APP_MARKER}
        if (System.getProperty('os.name').toLowerCase().contains('windows')) {
            externalNativeBuild {
                cmake {
                    arguments "-DCMAKE_OBJECT_PATH_MAX=230"
                }
            }
        }`;

const APP_ANDROID_SNIPPET = `    ${APP_MARKER}-staging
    if (System.getProperty('os.name').toLowerCase().contains('windows')) {
        externalNativeBuild {
            cmake {
                version "3.31.4"
                buildStagingDirectory = file("C:/Users/Public/c/a")
            }
        }
    }`;

module.exports = function withWindowsCmake(config) {
  config = withProjectBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes(PROJECT_MARKER)) {
      mod.modResults.contents = mod.modResults.contents.replace(
        'apply plugin: "expo-root-project"',
        `${PROJECT_SNIPPET}\napply plugin: "expo-root-project"`,
      );
    }
    return mod;
  });

  config = withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes(APP_MARKER)) {
      mod.modResults.contents = mod.modResults.contents.replace(
        /(buildConfigField\s+"String",\s+"REACT_NATIVE_RELEASE_LEVEL"[^\r\n]*)/,
        `$1\n${APP_DEFAULT_CONFIG_SNIPPET}`,
      );
    }
    if (!mod.modResults.contents.includes(`${APP_MARKER}-staging`)) {
      mod.modResults.contents = mod.modResults.contents.replace(
        /(androidResources\s*\{[\s\S]*?\})/,
        `$1\n${APP_ANDROID_SNIPPET}`,
      );
    }
    return mod;
  });

  return config;
};
