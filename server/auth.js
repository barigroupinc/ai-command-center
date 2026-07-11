const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'acc_token';

function signToken() {
  return jwt.sign({ sub: 'app-user' }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  next();
}

module.exports = { signToken, verifyToken, requireAuth, COOKIE_NAME };
