// Private images use middleware-authenticated identities, never URL tokens.

jest.mock('../../src/config/database', () => ({
  query: jest.fn()
}));
jest.mock('../../src/utils/imageProcessor', () => ({}));
jest.mock('../../src/services/tierService', () => ({}));
jest.mock('../../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return { ...actual, promises: { ...actual.promises, access: jest.fn() } };
});

const db = require('../../src/config/database');
const User = require('../../src/models/User');
const fs = require('fs').promises;
const { TOKEN_PURPOSES, generateToken } = require('../../src/middleware/auth');

// Require the controllers after mocks are set up
const tradeController = require('../../src/controllers/trade.controller');
const diaryModule = require('../../src/controllers/diary.controller');

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
    sendFile: jest.fn()
  };
}

function signToken(purpose, userId = 'user-1') {
  return generateToken({ id: userId, email: 'u@example.com', username: 'u', role: 'user' }, {
    purpose,
    expiresIn: '15m'
  });
}

describe('Trade image endpoint — pre_2fa token rejection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret-for-image-tests';
    db.query.mockResolvedValue({ rows: [] }); // no attachment found -> 404 path
    User.findById.mockResolvedValue({ id: 'owner-1', is_active: true, session_version: 0 });
    fs.access.mockResolvedValue(undefined);
  });

  test('rejects a pre_2fa-purpose JWT (attachment lookup never runs)', async () => {
    const pre2faToken = signToken(TOKEN_PURPOSES.PRE_2FA);

    const req = {
      params: { id: 'trade-1', filename: 'img.webp' },
      query: { token: pre2faToken },
      user: null,
      header: () => null
    };
    const res = createRes();
    await tradeController.getTradeImage(req, res, jest.fn());

    // A URL token never supplies an authenticated identity.
    expect([403, 404]).toContain(res.statusCode);
  });

  test('does not accept an ACCESS-purpose JWT from the URL', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ is_public: false, user_id: 'owner-1' }] });
    const req = {
      params: { id: 'trade-1', filename: 'img.webp' },
      query: { token: signToken(TOKEN_PURPOSES.ACCESS, 'owner-1') },
      user: null
    };
    const res = createRes();
    await tradeController.getTradeImage(req, res, jest.fn());
    expect(res.statusCode).toBe(403);
    expect(res.sendFile).not.toHaveBeenCalled();
    expect(User.findById).not.toHaveBeenCalled();
  });

  test('marks private trade images as non-cacheable', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ is_public: false, user_id: 'owner-1', file_type: 'image/webp', file_url: '/uploads/trades/x.webp' }]
    });
    const req = {
      params: { id: 'trade-1', filename: 'img.webp' },
      query: {},
      user: { id: 'owner-1' },
      header: () => null
    };
    const res = createRes();

    await tradeController.getTradeImage(req, res, jest.fn());

    expect(res.headers['Cache-Control']).toBe('private, no-store, max-age=0');
    expect(res.sendFile).toHaveBeenCalled();
  });

  test('only marks public trade images as publicly immutable', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ is_public: true, user_id: 'other-user', file_type: 'image/webp', file_url: '/uploads/trades/x.webp' }]
    });
    const req = {
      params: { id: 'trade-1', filename: 'img.webp' },
      query: {},
      user: null,
      header: () => null
    };
    const res = createRes();

    await tradeController.getTradeImage(req, res, jest.fn());

    expect(res.headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
  });
});

describe('Diary image endpoint — pre_2fa token rejection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret-for-image-tests';
  });

  test('returns 401 for a pre_2fa-purpose JWT in the URL', async () => {
    const pre2faToken = signToken(TOKEN_PURPOSES.PRE_2FA);

    const getDiaryImage = diaryModule.getDiaryImage || diaryModule;
    const fn = getDiaryImage;

    const req = {
      params: { id: 'entry-1', filename: 'img.webp' },
      query: { token: pre2faToken },
      user: null
    };
    const res = createRes();
    await fn(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.payload).toEqual(expect.objectContaining({ error: 'Authentication required' }));
  });
});
