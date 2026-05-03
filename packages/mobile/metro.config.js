const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// pnpm monorepo: Metro needs to watch the workspace root and resolve from it
config.watchFolders = [monorepoRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Ensure @reeeeecall/shared sources are resolved
config.resolver.disableHierarchicalLookup = false;

// CRITICAL: TypeScript sources must take precedence over any stale compiled
// .js artifacts that may exist alongside in the shared package. Without this,
// `.js` is resolved before `.ts` and code changes won't reach the runtime.
// See DOCS/DESIGN/MARKETPLACE_ACQUIRE/DESIGN.md §7.5 (FU6).
config.resolver.sourceExts = [
  'ts',
  'tsx',
  ...config.resolver.sourceExts.filter((ext) => !['ts', 'tsx'].includes(ext)),
];

module.exports = config;
