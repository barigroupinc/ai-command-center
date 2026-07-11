require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const http = require('http');

const { requireAuth } = require('./auth');
const { setupWebSocket } = require('./ws');
const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');

require('./db');

const REQUIRED_ENV = ['JWT_SECRET', 'APP_PASSWORD_HASH'];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in values (see README for how to generate APP_PASSWORD_HASH).');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/tasks', requireAuth, taskRoutes);
app.get('/api/me', requireAuth, (req, res) => res.json({ ok: true }));

const { broadcast } = setupWebSocket(server);
app.set('broadcast', broadcast);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`AI Command Center listening on port ${PORT}`);
});
