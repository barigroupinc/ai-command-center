const express = require('express');
const bcrypt = require('bcrypt');
const { signToken, COOKIE_NAME } = require('../auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'password required' });

  const hash = process.env.APP_PASSWORD_HASH;
  if (!hash) return res.status(500).json({ error: 'server not configured: APP_PASSWORD_HASH missing' });

  const ok = await bcrypt.compare(password, hash);
  if (!ok) return res.status(401).json({ error: 'invalid password' });

  const token = signToken();
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

module.exports = router;
