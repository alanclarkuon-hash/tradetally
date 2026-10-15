const morgan = require('morgan');

// Never put query values (including credentials and OAuth codes) in access logs.
// Read the original path so mounted routers cannot change what is recorded.
morgan.token('safe-path', req => (req.originalUrl || req.url || '/').split(/[?#]/, 1)[0]);
morgan.token('request-id', req => req.requestId || '-');

function createRequestLogger(options = {}) {
  return morgan(':method :safe-path :status :response-time ms req_id=:request-id', {
    skip(req) {
      if (process.env.NODE_ENV === 'production') return false;
      return req.path.includes('/import/history') || req.path.includes('/health') ||
        (req.path.includes('/trades') && req.query && req.query.page);
    },
    ...options
  });
}

module.exports = { createRequestLogger };
