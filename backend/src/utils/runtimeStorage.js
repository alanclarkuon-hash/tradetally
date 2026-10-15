const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sourceRoot = path.resolve(__dirname, '../../..');
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

function canonicalPath(value) {
  let current = path.resolve(value);
  const suffix = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    suffix.unshift(path.basename(current));
    current = parent;
  }
  return path.join(fs.realpathSync(current), ...suffix);
}

function repositoryRoot(value) {
  let current = value;
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function dedicatedContainerMount(value) {
  if (process.platform !== 'linux' || !fs.existsSync('/.dockerenv')) return false;
  try {
    return fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some(line => {
      const mount = (line.split(' ')[4] || '').replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
      // An entire source checkout mounted for development is not private storage.
      const privateMounts = [path.join(sourceRoot, 'backend/src/logs'), path.join(sourceRoot, 'backend/src/data')];
      return privateMounts.includes(mount) && inside(value, mount);
    });
  } catch { return false; }
}

function assertExternalStorage(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error('Runtime storage must use an absolute path outside source checkouts');
  }
  const resolved = canonicalPath(value);
  if ((inside(resolved, canonicalPath(sourceRoot)) || repositoryRoot(resolved)) && !dedicatedContainerMount(resolved)) {
    throw new Error('Runtime storage must be outside source checkouts or on a dedicated container volume');
  }
  return resolved;
}

function getRuntimeDirectory(kind) {
  if (!['logs', 'backups'].includes(kind)) throw new Error('Invalid runtime storage kind');
  const configured = process.env[kind === 'logs' ? 'LOG_DIR' : 'BACKUP_DIR'];
  let stateRoot = process.env.TRADETALLY_STATE_DIR;
  if (!stateRoot) {
    stateRoot = process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'TradeTally')
      : path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'tradetally');
  }
  return assertExternalStorage(configured || path.join(stateRoot, kind));
}

module.exports = { getRuntimeDirectory, assertExternalStorage };
