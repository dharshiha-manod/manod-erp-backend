/**
 * ====================================================
 * AUTHENTICATION MIDDLEWARE
 * JWT Token Verification
 * ====================================================
 */

const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
  // ── GET TOKEN FROM HEADER ──
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  // ── CHECK IF TOKEN EXISTS ──
  if (!token) {
    return res.status(401).json({ 
      error: 'Access token required',
      code: 'NO_TOKEN'
    });
  }

  // ── VERIFY TOKEN ──
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: 'Token expired',
          code: 'TOKEN_EXPIRED'
        });
      }
      return res.status(403).json({ 
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }

    // ── ATTACH USER TO REQUEST ──
    req.user = user;
    next();
  });
};

module.exports = authenticateToken;