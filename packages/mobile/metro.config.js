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

// Disable Node strict package-exports for the monorepo's @reeeeecall/shared.
// Why: Expo SDK 55 metro enables exports by default; the shared package's
// subpath patterns (e.g. "./lib/*": "./lib/*") map without extensions, and
// strict resolution refuses to fall back to .ts via sourceExts. This causes
// CI bundling to fail on @reeeeecall/shared/design-tokens/spacing while
// locally it slipped through due to stale .js artifacts.
// Workspace internals don't need exports gating; sourceExts above already
// guarantees TS-first resolution.
config.resolver.unstable_enablePackageExports = false;

// ONE i18next for the whole bundle, app and @reeeeecall/shared alike.
//
// This app declares `i18next: ^24.2.2` and the shared package declares `^25.8.10`. The ranges
// do not overlap, so pnpm installs two copies, and `import i18next from 'i18next'` meant two
// different singletons depending on which package the importing file lived in. `src/i18n`
// initialises the app's copy; nothing ever initialised the shared one.
//
// Every `i18next.t()` in `packages/shared/lib` therefore returned nothing on the phone, and it
// was visible: 학습 기록 rendered a session as "srs · 6장 · 0undefined" — the study-mode label
// falling back to its raw enum, and `formatDuration` concatenating a bare 0 with an undefined
// unit. `i18next.language` was undefined too, so the shared date formatter fell back to the
// system locale instead of the language the learner chose.
//
// Web never had this: it declares the same range as shared, so pnpm hoists one copy.
//
// Aliased rather than version-bumped on purpose. Shared's use of the singleton is `t()` and
// `.language`, identical in 24 and 25, whereas moving this app to 25 also moves react-i18next
// across a major and touches every screen. This makes the two agree today; aligning the
// versions is the follow-up, not the emergency.
// Resolved as if the import came from THIS package, wherever the importing file lives, rather
// than by hardcoding a path — so it keeps working under whatever layout the installer produces
// on CI and EAS.
const SINGLETONS = new Set(['i18next']);
const appOrigin = path.join(projectRoot, 'index.js');
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = SINGLETONS.has(moduleName)
    ? { ...context, originModulePath: appOrigin }
    : context;
  return defaultResolveRequest
    ? defaultResolveRequest(origin, moduleName, platform)
    : origin.resolveRequest(origin, moduleName, platform);
};

module.exports = config;
