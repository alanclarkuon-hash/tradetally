jest.mock('../../src/config/database', () => ({ withTransaction: jest.fn() }));
jest.mock('../../src/models/User', () => ({ create: jest.fn(), createSettings: jest.fn() }));
const db = require('../../src/config/database');
const User = require('../../src/models/User');
const { registerUser } = require('../../src/services/userRegistrationService');

describe('shared registration policy', () => {
  let client;
  beforeEach(() => {
    jest.resetAllMocks();
    client = { query: jest.fn(async sql => ({ rows: sql.includes('NOT EXISTS') ? [{ is_first_user: false }] : [] })) };
    db.withTransaction.mockImplementation(fn => fn(client));
    User.create.mockImplementation(async options => ({ id: 'synthetic-user', role: options.role }));
    User.createSettings.mockResolvedValue({});
  });

  test.each([
    [true, true, 'approval', 'admin', true, true, false],
    [false, true, 'approval', 'user', false, false, true],
    [false, false, 'approval', 'user', true, false, false],
    [false, true, 'open', 'user', false, true, true],
    [false, false, 'open', 'user', true, true, false]
  ])('uses the locked decision (%s, email %s, %s)', async (first, emailConfigured, registrationMode, role, isVerified, adminApproved, needsVerificationEmail) => {
    client.query.mockImplementation(async sql => ({ rows: sql.includes('NOT EXISTS') ? [{ is_first_user: first }] : [] }));
    const result = await registerUser({ email: 'synthetic@example.test', username: 'synthetic', password: 'synthetic-password' }, { emailConfigured, registrationMode });
    expect(result).toMatchObject({ isFirstUser: first, isVerified, adminApproved, needsVerificationEmail });
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ role, isVerified, adminApproved }), client);
    expect(User.createSettings).toHaveBeenCalledWith('synthetic-user', client);
    expect(client.query.mock.calls[0][0]).toBe('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    expect(client.query.mock.calls[1]).toEqual(['SELECT pg_advisory_xact_lock(hashtext($1))', ['tradetally:initial-registration']]);
    expect(client.query.mock.calls[2][0]).toBe('SELECT NOT EXISTS (SELECT 1 FROM users) AS is_first_user');
    if (needsVerificationEmail) expect(result.verificationToken).toMatch(/^[a-f0-9]{64}$/);
    else expect(result.verificationToken).toBeNull();
  });

  test('ignores submitted privilege and approval flags for later accounts', async () => {
    await registerUser({ email: 'synthetic@example.test', role: 'admin', isVerified: true, adminApproved: true }, { emailConfigured: true, registrationMode: 'approval' });
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ role: 'user', isVerified: false, adminApproved: false }), client);
  });

  test('does not write when transaction setup or locking fails', async () => {
    client.query.mockRejectedValueOnce(new Error('synthetic-lock-failure'));
    await expect(registerUser({}, {})).rejects.toThrow('synthetic-lock-failure');
    expect(User.create).not.toHaveBeenCalled();
  });

  test('propagates user-creation failure for transaction rollback', async () => {
    User.create.mockRejectedValueOnce(new Error('synthetic-insert-failure'));
    await expect(registerUser({}, {})).rejects.toThrow('synthetic-insert-failure');
    expect(User.createSettings).not.toHaveBeenCalled();
  });

  test('includes initial-settings failure in the registration transaction', async () => {
    User.createSettings.mockRejectedValueOnce(new Error('synthetic-settings-failure'));
    await expect(registerUser({}, {})).rejects.toThrow('synthetic-settings-failure');
  });
});
