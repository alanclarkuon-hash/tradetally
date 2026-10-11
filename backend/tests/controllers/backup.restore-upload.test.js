jest.mock('../../src/services/backup.service', () => ({ restoreFromBackup: jest.fn() }));
jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!req.get('X-Test-Role')) return res.sendStatus(401);
    req.user = { id: 'synthetic', role: req.get('X-Test-Role') }; next();
  },
  requireAdmin: (req, res, next) => req.user.role === 'admin' ? next() : res.sendStatus(403)
}));
const express = require('express');
const request = require('supertest');
const fs = require('node:fs/promises');
const os = require('node:os');
const service = require('../../src/services/backup.service');
const app = express();
app.use('/api/admin/backup', require('../../src/routes/backup.routes'));

describe('restore upload limits and cleanup', () => {
  beforeEach(() => jest.resetAllMocks());
  afterEach(async () => { delete process.env.BACKUP_MAX_FILE_SIZE; await new Promise(resolve => setTimeout(resolve, 30)); });
  test('authenticates before accepting a restore or disclosing limits', async () => {
    await request(app).post('/api/admin/backup/restore').expect(401);
    await request(app).get('/api/admin/backup/restore-limits').set('X-Test-Role', 'user').expect(403);
  });
  test('rejects oversized multipart with a useful error and removes staged files', async () => {
    process.env.BACKUP_MAX_FILE_SIZE = '32';
    const before = await fs.readdir(os.tmpdir());
    const result = await request(app).post('/api/admin/backup/restore').set('X-Test-Role', 'admin')
      .attach('file', Buffer.alloc(100), 'synthetic.json').expect(413);
    expect(result.body.error).toContain('upload limit');
    expect(service.restoreFromBackup).not.toHaveBeenCalled();
    // Cleanup completes in the handler's finally after the response.
    const deadline=Date.now()+2000;
    while(Date.now()<deadline){
      const remaining=(await fs.readdir(os.tmpdir())).filter(name=>name.startsWith('tradetally-restore-')&&!before.includes(name));
      if(!remaining.length)break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    expect((await fs.readdir(os.tmpdir())).filter(name => name.startsWith('tradetally-restore-') && !before.includes(name))).toEqual([]);
  });
  test('validates the entire file before invoking the restore transaction', async () => {
    await request(app).post('/api/admin/backup/restore').set('X-Test-Role', 'admin')
      .attach('file', Buffer.from('{"version":"1","tables":{"users":[{}]}} junk'), 'synthetic.json').expect(400);
    expect(service.restoreFromBackup).not.toHaveBeenCalled();
  });
  test('restores disk rows and cleans up after success', async () => {
    let stagedPath;
    service.restoreFromBackup.mockImplementation(async backup => {
      stagedPath = backup.tables.instanceConfig.filename;
      const rows = []; for await (const row of backup.tables.instanceConfig) rows.push(row);
      expect(rows).toEqual([{ key: 'synthetic', value: 'true' }]);
      return { results: {} };
    });
    await request(app).post('/api/admin/backup/restore').set('X-Test-Role', 'admin')
      .attach('file', Buffer.from(JSON.stringify({ version: '1', tables: { instanceConfig: [{ key: 'synthetic', value: 'true' }] } })), 'synthetic.json').expect(200);
    // Response completion precedes the asynchronous staging cleanup.
    const deadline=Date.now()+2000;
    while(Date.now()<deadline){
      try{await fs.access(stagedPath)}catch(error){if(error.code==='ENOENT')break;throw error}
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    await expect(fs.access(stagedPath)).rejects.toThrow();
  });
});
