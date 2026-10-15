const forge = require('node-forge');
const { generateKeyPairSync } = require('node:crypto');

// Structural regression for the upstream-proposed node-forge fix. All keys and
// messages are generated synthetic inputs; no service or account is contacted.
describe('RSA DigestInfo validation', () => {
  let publicKey, privateKey;
  beforeAll(() => {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 1024,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
    });
    publicKey = forge.pki.publicKeyFromPem(pair.publicKey);
    privateKey = forge.pki.privateKeyFromPem(pair.privateKey);
  });

  test('accepts valid RSA SHA-256 signatures', () => {
    const message = forge.md.sha256.create().update('synthetic-regression-message');
    const signature = privateKey.sign(message);
    expect(publicKey.verify(message.digest().getBytes(), signature)).toBe(true);
  });

  test.each([true, false])('rejects extra nested DigestAlgorithm elements (NULL parameters: %s)', includeNull => {
    const a = forge.asn1;
    const digest = forge.md.sha256.create().update('synthetic-regression-message').digest().getBytes();
    const algorithm = [a.create(a.Class.UNIVERSAL, a.Type.OID, false, a.oidToDer(forge.pki.oids.sha256).getBytes())];
    if (includeNull) algorithm.push(a.create(a.Class.UNIVERSAL, a.Type.NULL, false, ''));
    algorithm.push(a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, 'synthetic-extra'));
    const info = a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, [
      a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, algorithm),
      a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, digest)
    ]);
    const signature = privateKey.sign(a.toDer(info).getBytes(), 'NONE');
    expect(() => publicKey.verify(digest, signature)).toThrow(/DigestInfo/);
  });
});
