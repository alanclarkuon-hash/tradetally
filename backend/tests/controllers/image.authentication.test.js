jest.mock('../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../src/utils/imageProcessor', () => ({}));
jest.mock('../../src/services/tierService', () => ({}));
jest.mock('../../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return { ...actual, promises: { ...actual.promises, access: jest.fn().mockResolvedValue() } };
});
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const db = require('../../src/config/database');
const User = require('../../src/models/User');
const { authenticate, optionalAuth, generateToken, TOKEN_PURPOSES, clearAuthUserCache } = require('../../src/middleware/auth');
const { AUTH_COOKIE_NAME } = require('../../src/utils/authCookies');
const trade = require('../../src/controllers/trade.controller');
const diary = require('../../src/controllers/diary.controller');

const owner = { id: 'owner', is_active: true, session_version: 0 };
const token = (purpose = TOKEN_PURPOSES.ACCESS, session_version = 0) =>
  generateToken({ ...owner, session_version }, { purpose, expiresIn: '15m' });
function app() {
  const app = express();
  app.use(cookieParser());
  app.use((req, res, next) => { res.sendFile = () => res.send('synthetic image'); next(); });
  app.get('/trades/:id/images/:filename', optionalAuth, trade.getTradeImage);
  app.get('/diary/:id/images/:filename', authenticate, diary.getDiaryImage);
  return app;
}
beforeEach(() => {
  jest.clearAllMocks();
  clearAuthUserCache();
  process.env.JWT_SECRET = 'synthetic-image-test-secret';
  User.findById.mockResolvedValue(owner);
  db.query.mockResolvedValue({ rows: [{ user_id: owner.id, is_public: false, file_type: 'image/webp' }] });
});
for (const kind of ['trades', 'diary']) {
  describe(kind + ' image access', () => {
    test.each(['cookie', 'header'])('owner can load image using %s', async source => {
      let req = request(app()).get('/' + kind + '/example/images/image.webp');
      req = source === 'cookie' ? req.set('Cookie', AUTH_COOKIE_NAME + '=' + token()) : req.set('Authorization', 'Bearer ' + token());
      const res = await req;
      expect(res.status).toBe(200);
      expect(res.body.toString()).toBe('synthetic image');
      expect(res.headers['cache-control']).toBe('private, no-store, max-age=0');
    });
    test('URL access token alone cannot authenticate', async () => {
      const res = await request(app()).get('/' + kind + '/example/images/image.webp').query({ token: token() });
      expect([401,403]).toContain(res.status);
      expect(User.findById).not.toHaveBeenCalled();
    });
    test('another owner cannot read image', async () => {
      db.query.mockResolvedValue({ rows: [{ user_id: 'someone-else', is_public: false }] });
      const res = await request(app()).get('/' + kind + '/example/images/image.webp').set('Authorization', 'Bearer ' + token());
      expect(res.status).toBe(403);
    });
    test.each([TOKEN_PURPOSES.PRE_2FA, TOKEN_PURPOSES.WIDGET_SNAPSHOT])('rejects %s token in header', async purpose => {
      const res = await request(app()).get('/' + kind + '/example/images/image.webp').set('Authorization', 'Bearer ' + token(purpose));
      expect([401,403]).toContain(res.status);
    });
    test('revoked session cannot read image', async () => {
      const res = await request(app()).get('/' + kind + '/example/images/image.webp').set('Authorization', 'Bearer ' + token(TOKEN_PURPOSES.ACCESS, 1));
      expect([401,403]).toContain(res.status);
    });
    test('inactive owner cannot read image', async () => {
      User.findById.mockResolvedValue({ ...owner, is_active: false });
      const res = await request(app()).get('/' + kind + '/example/images/image.webp').set('Authorization', 'Bearer ' + token());
      expect([401,403]).toContain(res.status);
    });
  });
}
test('public trade image remains available without authentication', async () => {
  db.query.mockResolvedValue({ rows: [{ user_id: 'another-owner', is_public: true, file_type: 'image/webp' }] });
  const res = await request(app()).get('/trades/example/images/image.webp');
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
});
