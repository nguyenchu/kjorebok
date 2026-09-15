module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Reanimated 4 moved the worklet runtime here; its own plugin entry is now
    // just a re-export of this one.
    plugins: ["react-native-worklets/plugin"],
  };
};
