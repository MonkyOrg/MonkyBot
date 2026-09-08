const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const allowed = fs.realpathSync(process.env.MONKYBOT_SMOKE_MODULES);
const originalResolve = Module._resolveFilename;

// A directory under the repository still inherits its ancestor node_modules.
// Reject that fallback so missing bundled dependencies cannot pass this smoke.
Module._resolveFilename = function (...args) {
  const resolved = Reflect.apply(originalResolve, this, args);
  if (!Module.isBuiltin(resolved)) {
    const relative = path.relative(allowed, fs.realpathSync(resolved));
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Module escaped isolated installation: ${resolved}`);
    }
  }
  return resolved;
};
