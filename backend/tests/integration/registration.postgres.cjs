// Opt-in synthetic PostgreSQL checks. Never run against a real account DB.
// Requires DB_NAME=tradetally_registration_security_test and a disposable DB.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
if (process.env.DB_NAME !== 'tradetally_registration_security_test') throw Error('Disposable registration database required');
const db = require('../../src/config/database');
const User = require('../../src/models/User');
const { registerUser } = require('../../src/services/userRegistrationService');
const policy = { emailConfigured: true, registrationMode: 'approval' };
const account = name => ({ email: name + '@example.test', username: name, password: 'synthetic-password' });
const reset = () => db.query('TRUNCATE users CASCADE');

async function main() {
  assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name, 'tradetally_registration_security_test');
  if (process.argv[2] === '--worker') {
    const result = await registerUser(account(process.argv[3]), policy);
    const isolation=(await db.query("SELECT current_setting('default_transaction_isolation') AS value")).rows[0].value;
    console.log(JSON.stringify({ role: result.user.role, first: result.isFirstUser, pid: process.pid, defaultIsolation: isolation }));
    return;
  }
  await db.query(`CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL,
    username text UNIQUE NOT NULL, password_hash text NOT NULL, full_name text,
    verification_token text, verification_expires timestamptz, role text,
    is_verified boolean, admin_approved boolean, tier text, marketing_consent boolean,
    avatar_url text, is_active boolean DEFAULT true, timezone text DEFAULT 'UTC',
    session_version integer DEFAULT 0, created_at timestamptz DEFAULT now()
  ); CREATE TABLE user_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE
  )`);

  const results = await Promise.all(Array.from({length:8}, (_,i)=>registerUser(account('parallel_'+i), policy)));
  assert.equal(results.filter(r=>r.isFirstUser).length,1);
  assert.equal(results.filter(r=>r.user.role==='admin').length,1);
  for (const r of results) {
    assert.equal(r.adminApproved,r.isFirstUser);
    assert.equal(r.isVerified,r.isFirstUser);
    assert.equal(r.needsVerificationEmail,!r.isFirstUser);
    assert.equal(r.user.tier,r.isFirstUser?'pro':'free');
    const stored=(await db.query('SELECT verification_token FROM users WHERE id=$1',[r.user.id])).rows[0].verification_token;
    assert.equal(stored,r.verificationToken?crypto.createHash('sha256').update(r.verificationToken).digest('hex'):null);
  }
  assert.equal(Number((await db.query('SELECT count(*) FROM user_settings')).rows[0].count),8);

  await reset();
  const workers=await Promise.all(['worker_a','worker_b'].map(name=>execFile(process.execPath,[__filename,'--worker',name],{env:process.env})));
  const outcomes=workers.map(r=>JSON.parse(r.stdout.trim().split('\n').filter(line=>line.startsWith('{')).pop()));
  assert.notEqual(outcomes[0].pid,outcomes[1].pid);
  assert.equal(outcomes.filter(r=>r.first&&r.role==='admin').length,1);
  assert.equal(outcomes.filter(r=>!r.first&&r.role==='user').length,1);

  await db.query('UPDATE users SET is_active=false');
  const inactive = await registerUser(account('after_inactive'),policy);
  assert.equal(inactive.isFirstUser,false);assert.equal(inactive.user.role,'user');assert.equal(inactive.adminApproved,false);

  await reset();
  const originalSettings=User.createSettings;
  try {
    User.createSettings=async()=>{throw Error('synthetic-settings-failure');};
    await assert.rejects(registerUser(account('rolled_back'),policy),/synthetic-settings-failure/);
  } finally { User.createSettings=originalSettings; }
  assert.equal(Number((await db.query('SELECT count(*) FROM users')).rows[0].count),0);
  const recovered=await registerUser(account('after_rollback'),policy);assert.equal(recovered.isFirstUser,true);

  await reset();
  const duplicate=await Promise.allSettled([registerUser(account('duplicate'),policy),registerUser(account('duplicate'),policy)]);
  assert.equal(duplicate.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(duplicate.filter(r=>r.status==='rejected'&&r.reason.code==='23505').length,1);
  assert.equal((await registerUser(account('after_duplicate'),policy)).isFirstUser,false);

  await reset();
  await db.query("ALTER DATABASE tradetally_registration_security_test SET default_transaction_isolation TO 'repeatable read'");
  const isolationWorkers=await Promise.all(['isolation_a','isolation_b'].map(name=>execFile(process.execPath,[__filename,'--worker',name],{env:process.env})));
  const isolation=isolationWorkers.map(r=>JSON.parse(r.stdout.trim().split('\n').filter(line=>line.startsWith('{')).pop()));
  assert.ok(isolation.every(r=>r.defaultIsolation==='repeatable read'));
  assert.equal(isolation.filter(r=>r.first).length,1);
  console.log(JSON.stringify({eightConcurrentRegistrations:true,crossProcessSerialization:true,oneAdministratorOnly:true,approvalAndVerificationCorrect:true,inactiveAccountsDoNotReopenBootstrap:true,failedSetupRollsBack:true,duplicateFailureReleasesLock:true,verificationTokensHashed:true,repeatableReadDefaultSafe:true}));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>db.pool.end());
