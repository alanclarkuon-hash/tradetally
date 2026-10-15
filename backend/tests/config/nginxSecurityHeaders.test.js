const fs = require('fs');
const path = require('path');

describe('bundled nginx security headers', () => {
  const nginxConfig = fs.readFileSync(
    path.resolve(__dirname, '../../../docker/nginx.conf'),
    'utf8'
  );

  test('hides upstream headers that nginx adds to proxied responses', () => {
    const defaultServerStart = nginxConfig.indexOf('listen 80 default_server;');
    const firstLocationStart = nginxConfig.indexOf('location ', defaultServerStart);
    const serverPreamble = nginxConfig.slice(defaultServerStart, firstLocationStart);
    const overlappingHeaders = [
      'Content-Security-Policy',
      'X-Frame-Options',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Cross-Origin-Resource-Policy',
      'Cross-Origin-Opener-Policy'
    ];

    expect(defaultServerStart).toBeGreaterThan(-1);
    expect(firstLocationStart).toBeGreaterThan(defaultServerStart);

    for (const header of overlappingHeaders) {
      expect(serverPreamble).toContain(`add_header ${header} `);
      expect(serverPreamble).toContain(`proxy_hide_header ${header};`);
    }
  });
});


test('nginx access logs exclude request queries and referrers', () => {
  const config = require('fs').readFileSync(require('path').resolve(__dirname, '../../../docker/nginx.conf'), 'utf8');
  const format = config.match(/log_format tradetally_safe ([\s\S]*?);/)[1];
  expect(format).toContain('$uri');
  expect(format).not.toMatch(/\$request(?:["'\s]|_uri)|\$args|\$query_string|\$http_referer/);
  expect(config).toContain('access_log /var/log/nginx/access.log tradetally_safe;');
});
