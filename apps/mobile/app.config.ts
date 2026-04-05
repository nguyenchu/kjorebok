const appJson = require("./app.json");

function getAutoVersion() {
  const configuredVersion = appJson.expo.version;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(configuredVersion);

  if (!match) {
    return {
      version: configuredVersion,
      versionCode: appJson.expo.android.versionCode,
    };
  }

  const [, major, minor] = match;
  const runNumber = process.env.ANDROID_VERSION_CODE ?? process.env.GITHUB_RUN_NUMBER;

  if (!runNumber) {
    return {
      version: configuredVersion,
      versionCode: appJson.expo.android.versionCode,
    };
  }

  const versionCode = Number.parseInt(runNumber, 10);
  if (!Number.isFinite(versionCode) || versionCode <= 0) {
    return {
      version: configuredVersion,
      versionCode: appJson.expo.android.versionCode,
    };
  }

  return {
    version: `${major}.${minor}.${versionCode}`,
    versionCode,
  };
}

const autoVersion = getAutoVersion();

module.exports = {
  expo: {
    ...appJson.expo,
    version: process.env.APP_VERSION ?? autoVersion.version,
    android: {
      ...appJson.expo.android,
      versionCode: autoVersion.versionCode,
    },
  },
};
