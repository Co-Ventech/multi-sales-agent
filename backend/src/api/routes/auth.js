const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = await User.findOne({ username: username.trim() });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.SERVER_URL?.startsWith('https') ?? false,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });

  return res.json({
    user: {
      id: user._id,
      username: user.username,
      role: user.role
    }
  });
}));

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.SERVER_URL?.startsWith('https') ?? false,
    sameSite: 'lax'
  });
  return res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  return res.json({
    user: {
      id: req.user._id,
      username: req.user.username,
      role: req.user.role
    }
  });
});

// POST /api/auth/setup — only if no users exist
router.post('/setup', asyncHandler(async (req, res) => {
  const count = await User.countDocuments();
  if (count > 0) {
    return res.status(403).json({ error: 'Setup already completed' });
  }

  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ username: username.trim(), passwordHash, role: 'admin' });

  return res.status(201).json({
    message: 'Admin account created',
    user: { id: user._id, username: user.username, role: user.role }
  });
}));

module.exports = router;
