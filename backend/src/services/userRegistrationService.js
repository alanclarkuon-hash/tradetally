const crypto = require('crypto');
const db = require('../config/database');
const User = require('../models/User');

// All public registration routes share a database lock, including across app
// processes. Role and account policy must be decided before the same commit.
async function registerUser({ email, username, password, fullName, marketingConsent = false }, { emailConfigured, registrationMode }) {
  return db.withTransaction(async client => {
    // Each statement after the lock must see the preceding registrant's commit,
    // even if the database's default isolation level is repeatable read.
    await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['tradetally:initial-registration']);
    // Inactive accounts still mean this is an established installation.
    const result = await client.query('SELECT NOT EXISTS (SELECT 1 FROM users) AS is_first_user');
    const isFirstUser = result.rows[0].is_first_user;
    const isVerified = !emailConfigured || isFirstUser;
    const adminApproved = registrationMode !== 'approval' || isFirstUser;
    const needsVerificationEmail = Boolean(emailConfigured && !isFirstUser);
    const verificationToken = needsVerificationEmail ? crypto.randomBytes(32).toString('hex') : null;
    const verificationExpires = needsVerificationEmail ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null;
    const user = await User.create({
      email, username, password, fullName, marketingConsent,
      role: isFirstUser ? 'admin' : 'user', isVerified, adminApproved,
      verificationToken, verificationExpires
    }, client);
    await User.createSettings(user.id, client);
    return { user, isFirstUser, isVerified, adminApproved, needsVerificationEmail, verificationToken };
  });
}

module.exports = { registerUser };
