// Test-only ESM resolve hook: app source uses extensionless relative imports
// (bundler resolution), but Node's --experimental-strip-types loader requires
// explicit extensions. Retry failed relative resolutions with ".ts" appended.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
    const hasExtension = /\.[a-z]+$/i.test(specifier);
    if (err?.code === 'ERR_MODULE_NOT_FOUND' && isRelative && !hasExtension) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw err;
  }
}
