const fs = require('node:fs');
const { assertExternalStorage } = require('./runtimeStorage');

function maintenancePaths(args) {
  const arg = name => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  // Validate every destination before opening configuration or connecting to a database.
  return { envFile: assertExternalStorage(arg('env-file')), report: assertExternalStorage(arg('report')),
    backup: args.includes('--apply') ? assertExternalStorage(arg('backup')) : null };
}
function writePrivateReport(destination, value) {
  const descriptor = fs.openSync(assertExternalStorage(destination), 'wx', 0o600);
  try { fs.writeFileSync(descriptor, JSON.stringify(value, null, 2)); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}
module.exports = { maintenancePaths, writePrivateReport };
