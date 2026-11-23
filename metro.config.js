const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('sqlite', 'wasm');

const sqliteWasmDist = path.join(
  path.dirname(require.resolve('@sqlite.org/sqlite-wasm/package.json')),
  'dist',
);
const sqliteWasmBareFiles = new Set([
  'sqlite3-worker1.mjs',
  'sqlite3-opfs-async-proxy.js',
  'sqlite3.wasm',
]);

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (sqliteWasmBareFiles.has(moduleName)) {
    return {
      filePath: path.join(sqliteWasmDist, moduleName),
      type: 'sourceFile',
    };
  }
  if (upstreamResolveRequest) {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
