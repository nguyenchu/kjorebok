const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch all files in the monorepo (needed for @kjorebok/shared etc.)
config.watchFolders = [monorepoRoot];

// Resolve packages from both the app's own node_modules and the hoisted
// monorepo root node_modules (pnpm stores deps here).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Expo adds "source" to resolverMainFields which makes Metro prefer
// react-native-screens/src/ (raw TypeScript) over the compiled output,
// causing "Unknown prop type" Fabric spec errors. Drop "source" so Metro
// uses the compiled main/react-native fields instead.
config.resolver.resolverMainFields = ["react-native", "browser", "main", "module"];


module.exports = config;
