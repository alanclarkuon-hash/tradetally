const express = require('express');
const request = require('supertest');
const { createRequestLogger } = require('../../src/middleware/requestLogger');

test.each([
  '?token=synthetic-secret&token=another-secret',
  '?%74oken=encoded-secret&access_token=access-secret',
  '?code=oauth-secret&unknown=private-value',
  '?TOKEN=upper-secret&password=pass-secret'
])('access logs omit the complete query string: %s', async query => {
  let output = '';
  const app = express();
  app.use((req, res, next) => { req.requestId = 'synthetic-request'; next(); });
  app.use(createRequestLogger({ stream: { write(line) { output += line; } }, skip: () => false }));
  app.get('/images/example.webp', (req, res) => res.sendStatus(403));
  await request(app).get('/images/example.webp' + query);
  expect(output).toMatch(/^GET \/images\/example.webp 403 /);
  expect(output).toContain('req_id=synthetic-request');
  expect(output).not.toContain('?');
  for (const value of new URLSearchParams(query)) expect(output).not.toContain(value[1]);
});
