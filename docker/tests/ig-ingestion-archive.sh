#!/bin/sh
# Isolated image test: no database, network, broker files or host mounts required.
set -eu
root=$(mktemp -d /tmp/ig-archive-smoke.XXXXXX)
export IG_INGEST_FOLDER="$root" ENABLE_IG_STATEMENT_INGESTER=true
chmod 777 "$root"
mkdir "$root/Processed"
chmod 755 "$root/Processed"
printf '%%PDF synthetic archive smoke' > "$root/synthetic.pdf"
su-exec appuser node - <<'JS'
const assert=require('assert/strict'),source=require('/app/backend/src/services/igStatementSource').folderSource(process.env.IG_INGEST_FOLDER);
source.checkArchive().then(()=>{throw Error('Expected root-owned archive to reject the service user')},e=>assert.equal(e.code,'EACCES')).catch(e=>{console.error(e);process.exitCode=1});
JS
node /app/backend/src/utils/prepareIgIngestion.js
su-exec appuser node - <<'JS'
const assert=require('assert/strict'),fs=require('fs/promises'),path=require('path');
(async()=>{const root=process.env.IG_INGEST_FOLDER,source=require('/app/backend/src/services/igStatementSource').folderSource(root);await source.checkArchive();await source.acknowledge('synthetic.pdf');assert.equal(await fs.readFile(path.join(root,'Processed/synthetic.pdf'),'utf8'),'%PDF synthetic archive smoke');
await fs.writeFile(path.join(root,'synthetic.pdf'),'%PDF synthetic archive smoke');await source.acknowledge('synthetic.pdf');assert.equal((await source.list()).length,0);console.log('PASS: root-owned archive repaired; import receipt retry archives exactly once');})().catch(e=>{console.error(e);process.exitCode=1});
JS
mv "$root/Processed" "$root/SavedArchive"
mkdir "$root/Outside"
ln -s "$root/Outside" "$root/Processed"
node /app/backend/src/utils/prepareIgIngestion.js
node - <<'JS'
const fs=require('fs'),assert=require('assert/strict'),root=process.env.IG_INGEST_FOLDER;
assert.equal(fs.statSync(root+'/Outside').uid,0);assert.ok(fs.lstatSync(root+'/Processed').isSymbolicLink());console.log('PASS: archive symlink rejected without changing its target');
JS
