const rateLimit = require('express-rate-limit');

// Helper function to get real IP address (works behind proxy)
const getRealIP = (req) => {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.ip ||
    'unknown';
};

const sendRateLimitResponse = (req, res, message, retryAfterSeconds = null) => {
  const acceptsHtml = String(req.headers.accept || '').includes('text/html');
  if (acceptsHtml) {
    const retryLine = retryAfterSeconds
      ? `<p class="hint">Please try again in about ${retryAfterSeconds} seconds.</p>`
      : '<p class="hint">Please wait a bit and then retry.</p>';
    return res.status(429).type('html').send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Too Many Requests</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f7f8fb; color: #222; margin: 0; }
    .card { max-width: 560px; margin: 10vh auto; background: #fff; border: 1px solid #e4e7ee; border-radius: 12px; padding: 24px; box-shadow: 0 8px 24px rgba(0,0,0,0.05); }
    h1 { margin: 0 0 12px; font-size: 22px; }
    p { margin: 0 0 10px; line-height: 1.5; }
    .hint { color: #667085; }
  </style>
</head>
<body>
  <main class="card">
    <h1>Too Many Requests</h1>
    <p>${message}</p>
    ${retryLine}
  </main>
</body>
</html>`);
  }

  const payload = { message };
  if (retryAfterSeconds) payload.retryAfter = retryAfterSeconds;
  return res.status(429).json(payload);
};

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getRealIP(req), // Use custom IP extraction
});

// Strict rate limiter for vulnerable endpoints
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  keyGenerator: (req) => getRealIP(req), // Use custom IP extraction
});

// Contact/Quotation form rate limiter
const formLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 submissions per hour
  message: 'Too many form submissions from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getRealIP(req), // Use custom IP extraction
  skipSuccessfulRequests: false, // Count all requests, even successful ones
  skipFailedRequests: false, // Count all requests, even failed ones
  handler: (req, res) => {
    return sendRateLimitResponse(
      req,
      res,
      'Too many form submissions from this IP, please try again later.',
      3600,
    );
  },
});

// Payment link resolver IP limiter
const paymentLinkIpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30, // Limit each IP to 30 attempts per window
  message: 'Too many payment link attempts from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getRealIP(req),
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  handler: (req, res) => {
    return sendRateLimitResponse(
      req,
      res,
      'Too many payment link attempts from this IP, please try again later.',
    );
  },
});

// Payment link resolver token limiter (token + IP)
const paymentLinkTokenLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Limit each token+IP pair to 5 attempts per minute
  message: 'Too many attempts for this payment link, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = getRealIP(req);
    const token = String(req.params?.token || '');
    return `${ip}:${token}`;
  },
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  handler: (req, res) => {
    return sendRateLimitResponse(
      req,
      res,
      'Too many attempts for this payment link, please try again later.',
    );
  },
});

// Login rate limiter: 3 failed attempts, then wait 5 minutes
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  max: 3,
  message: 'Too many login attempts. Please try again in 5 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Successful logins do not count
  skipFailedRequests: false,
  keyGenerator: (req) => {
    const ip = getRealIP(req);
    const email = String(req.body?.email || '').trim().toLowerCase();
    return email ? `${ip}:${email}` : ip;
  },
  handler: (req, res, next, options) => {
    const retryAfterSeconds = Math.ceil(LOGIN_WINDOW_MS / 1000);
    return res.status(options.statusCode).json({
      success: false,
      message: options.message,
      retryAfter: retryAfterSeconds,
    });
  },
});

// Exit-intent coupon mint: prevent coupon farming
const EXIT_INTENT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const exitIntentLimiter = rateLimit({
  windowMs: EXIT_INTENT_WINDOW_MS,
  max: 5, // Max 5 unique coupons per IP per hour
  message: 'Too many discount requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getRealIP(req),
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  handler: (req, res) => {
    return sendRateLimitResponse(
      req,
      res,
      'Too many discount requests from this IP, please try again later.',
      Math.ceil(EXIT_INTENT_WINDOW_MS / 1000),
    );
  },
});

module.exports = {
  apiLimiter,
  strictLimiter,
  formLimiter,
  paymentLinkIpLimiter,
  paymentLinkTokenLimiter,
  loginLimiter,
  exitIntentLimiter,
};

