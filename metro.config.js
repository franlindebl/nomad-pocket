// Metro: bundle the world basemap (assets/maps/world.pmtiles) as an asset.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('pmtiles');

module.exports = config;
