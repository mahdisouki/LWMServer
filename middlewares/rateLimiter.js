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
    res.status(429).json({
      message: 'Too many form submissions from this IP, please try again later.',
      retryAfter: 3600, // Retry after 1 hour in seconds
    });
  },
});

module.exports = {
  apiLimiter,
  strictLimiter,
  formLimiter,
};

