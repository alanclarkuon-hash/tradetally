jest.mock('../../src/services/backup.service', () => ({ getFailureStatus: jest.fn() }));
jest.mock('../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    const role = req.get('X-Test-Role');
    if (!role) return res.status(401).json({ error: 'Authentication required' });
    req.user = { id: 'synthetic-user', role }; next();
  },
  requireAdmin: (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin required' })
}));
const request = require('supertest');
const express = require('express');
const service = require('../../src/services/backup.service');
const router = require('../../src/routes/backup.routes');
const app = express();
app.use('/api/admin/backup', router);
app.use((error, req, res, next) => res.status(503).json({ error: 'Status unavailable' }));
describe('backup failure status route', () => {
  beforeEach(() => jest.resetAllMocks());
  test('requires authentication and admin access before reading status', async () => {
    await request(app).get('/api/admin/backup/failure-status').expect(401);
    await request(app).get('/api/admin/backup/failure-status').set('X-Test-Role','user').expect(403);
    expect(service.getFailureStatus).not.toHaveBeenCalled();
  });
  test('returns uncached sanitized status for an administrator', async () => {
    service.getFailureStatus.mockResolvedValue({ failed: true, failedAt: '2026-01-01T12:00:00Z' });
    const response = await request(app).get('/api/admin/backup/failure-status').set('X-Test-Role','admin').expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ failed: true, failedAt: '2026-01-01T12:00:00Z' });
  });
  test('surfaces status-check failure without reporting a successful backup', async () => {
    service.getFailureStatus.mockRejectedValue(Error('synthetic unavailable'));
    const response = await request(app).get('/api/admin/backup/failure-status').set('X-Test-Role','admin').expect(503);
    expect(response.body.failed).toBeUndefined();
  });
});