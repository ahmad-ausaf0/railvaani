// Node customization hook so the compiled API runs under plain Node.
//
// The workspace packages compile with extensionless relative imports
// (bundler-style), which plain Node ESM refuses. This hook re-resolves those
// specifiers by appending .js (or /index.js for directory imports). It only
// steps in when the default resolution fails, so everything else is untouched.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
    const missing = error?.code === 'ERR_MODULE_NOT_FOUND';
    const dirImport = error?.code === 'ERR_UNSUPPORTED_DIR_IMPORT';
    if (!isRelative || !(missing || dirImport)) throw error;
    const candidates = dirImport ? [`${specifier}/index.js`] : [`${specifier}.js`];
    for (const candidate of candidates) {
      try {
        return await nextResolve(candidate, context);
      } catch {
        // Fall through and surface the original error below.
      }
    }
    throw error;
  }
}
