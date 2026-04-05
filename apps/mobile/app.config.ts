const appJson = require("./app.json");
const configuredVersion = appJson.expo.version;
const configuredVersionCode = appJson.expo.android.versionCode;
const envVersionCode = Number.parseInt(process.env.ANDROID_VERSION_CODE ?? "", 10);
const resolvedVersionCode =
  Number.isFinite(envVersionCode) && envVersionCode > 0
    ? envVersionCode
    : configuredVersionCode;

module.exports = {
  expo: {
    ...appJson.expo,
    version: process.env.APP_VERSION ?? configuredVersion,
    android: {
      ...appJson.expo.android,
      versionCode: resolvedVersionCode,
    },
  },
};
