const fs = require("fs");
const path = require("path");
const { IOSConfig, withDangerousMod, withXcodeProject } = require("expo/config-plugins");

const INTENTS_FILE = "KjorebokCarIntents.swift";
const SOURCE = path.join(__dirname, "..", "app-intents", INTENTS_FILE);

/**
 * Compiles the car App Intents into the app target itself. Shortcuts only
 * lists intents whose metadata Xcode extracts at build time, which it does
 * reliably for the app target but not for the static frameworks that Expo
 * modules are built as.
 */
const withCarShortcut = (config) => {
  config = withDangerousMod(config, [
    "ios",
    async (modConfig) => {
      const { platformProjectRoot, projectName } = modConfig.modRequest;
      fs.copyFileSync(SOURCE, path.join(platformProjectRoot, projectName, INTENTS_FILE));
      return modConfig;
    },
  ]);

  return withXcodeProject(config, (modConfig) => {
    const { projectName } = modConfig.modRequest;
    const filepath = `${projectName}/${INTENTS_FILE}`;
    if (!modConfig.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: projectName,
        project: modConfig.modResults,
      });
    }
    return modConfig;
  });
};

module.exports = withCarShortcut;
