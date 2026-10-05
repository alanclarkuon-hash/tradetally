const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { JSONParser, TokenType } = require('@streamparser/json');

const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_RECORD_BYTES = 16 * 1024 * 1024;
function uploadLimit() {
  const configured = Number(process.env.BACKUP_MAX_FILE_SIZE || MAX_UPLOAD_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, MAX_UPLOAD_BYTES) : MAX_UPLOAD_BYTES;
}

// Re-openable rows allow the existing dependency-order retry pass to run without
// retaining a whole backup (or a whole table) in the Node heap.
class DiskRows {
  constructor(filename) { this.filename = filename; this.length = 0; }
  async *[Symbol.asyncIterator]() {
    const input = fs.createReadStream(this.filename);
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    try { for await (const line of lines) yield JSON.parse(line); }
    finally { lines.close(); input.destroy(); }
  }
}

async function stageBackup(filename, directory) {
  const tables = Object.create(null);
  const handles = new Map();
  const parser = new JSONParser({ paths: ['$.version', '$.tables.*.*'], keepStack: false, stringBufferSize: 65536 });
  let version, depth = 0, rootKey, tableKey, tablesSeen = false, bytes = 0, lastBoundary = 0, recordStart = null;
  const rootKeys = new Set(), tableKeys = new Set();
  let previous;
  parser.onToken = ({ token, value, offset }) => {
    if (token === TokenType.COLON && depth === 1) {
      rootKey = previous;
      if (rootKeys.has(rootKey)) throw new Error('Duplicate backup property');
      rootKeys.add(rootKey);
    }
    if (token === TokenType.COLON && depth === 2 && rootKey === 'tables') {
      tableKey = previous;
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableKey) || tableKeys.has(tableKey)) throw new Error('Invalid backup table');
      tableKeys.add(tableKey);
    }
    if (previous === TokenType.COLON && depth === 1 && rootKey === 'tables') {
      if (token !== TokenType.LEFT_BRACE) throw new Error('Backup tables must be an object');
      tablesSeen = true;
    }
    if (previous === TokenType.COLON && depth === 2 && rootKey === 'tables') {
      if (token !== TokenType.LEFT_BRACKET) throw new Error('Backup table rows must be an array');
      const rows = new DiskRows(path.join(directory, `table-${tableKeys.size}.ndjson`));
      tables[tableKey] = rows;
      handles.set(tableKey, fs.openSync(rows.filename, 'wx', 0o600));
    }
    if (depth === 0 && token !== TokenType.LEFT_BRACE) throw new Error('Backup must be an object');
    if (depth === 3 && rootKey === 'tables' && token === TokenType.LEFT_BRACE) recordStart = offset;
    if (token === TokenType.LEFT_BRACE || token === TokenType.LEFT_BRACKET) depth++;
    if (token === TokenType.RIGHT_BRACE || token === TokenType.RIGHT_BRACKET) depth--;
    if (depth > 100) throw new Error('Backup nesting exceeds the supported limit');
    previous = token === TokenType.STRING ? value : token;
    // Offset is used only for resource accounting, never as a file path.
    if (token === TokenType.COMMA || token === TokenType.RIGHT_BRACKET) lastBoundary = offset;
  };
  parser.onValue = ({ value, key, stack }) => {
    if (stack.length === 1 && key === 'version') { version = value; return; }
    if (stack.length !== 3) return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Backup rows must be objects');
    const name = stack[2].key;
    const line = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(line) > MAX_RECORD_BYTES) throw new Error('Backup record exceeds 16 MiB');
    fs.writeSync(handles.get(name), line);
    tables[name].length++;
    recordStart = null;
  };
  try {
    for await (const chunk of fs.createReadStream(filename, { highWaterMark: 65536 })) {
      bytes += chunk.length;
      if (bytes > uploadLimit()) throw new Error('Backup exceeds upload limit');
      parser.write(chunk);
      // Pretty-printed legacy exports may have substantial whitespace. Bound
      // their encoded span separately; the compact row limit is checked above.
      if (recordStart !== null && bytes - recordStart > MAX_RECORD_BYTES * 8 + 65536) throw new Error('Backup record exceeds the encoded size limit');
      if (bytes - lastBoundary > MAX_RECORD_BYTES + 65536) throw new Error('Backup record exceeds 16 MiB');
    }
    if (!parser.isEnded) parser.end();
    if (!version || !tablesSeen) throw new Error('Missing version or tables');
    return { version, tables };
  } finally {
    for (const handle of handles.values()) fs.closeSync(handle);
  }
}

module.exports = { stageBackup, DiskRows, uploadLimit, MAX_RECORD_BYTES };
