const express = require('express');
const db = require('../db');
const { orchestrate } = require('../orchestrator');

const router = express.Router();

router.get('/', (req, res) => {
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT 50').all();
  res.json(tasks.reverse());
});

router.get('/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });
  const runs = db.prepare('SELECT * FROM agent_runs WHERE task_id = ? ORDER BY id').all(req.params.id);
  const messages = db.prepare('SELECT * FROM messages WHERE task_id = ? ORDER BY id').all(req.params.id);
  res.json({ ...task, runs, messages });
});

router.post('/', async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt required' });

  const taskId = db.prepare('INSERT INTO tasks (prompt, status) VALUES (?, ?)').run(prompt.trim(), 'pending')
    .lastInsertRowid;
  db.prepare('INSERT INTO messages (task_id, role, content) VALUES (?, ?, ?)').run(taskId, 'user', prompt.trim());

  res.status(201).json({ id: taskId, status: 'pending' });

  const broadcast = req.app.get('broadcast');
  broadcast({ type: 'task_update', taskId, status: 'pending' });

  try {
    const finalAnswer = await orchestrate(taskId, prompt.trim(), (update) => {
      broadcast({ type: 'agent_update', taskId, ...update });
    });
    db.prepare('INSERT INTO messages (task_id, role, content) VALUES (?, ?, ?)').run(
      taskId,
      'assistant',
      finalAnswer
    );
    broadcast({ type: 'task_update', taskId, status: 'done', finalAnswer });
  } catch (err) {
    const message = err.message || String(err);
    db.prepare(`UPDATE tasks SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?`).run(
      message,
      taskId
    );
    broadcast({ type: 'task_update', taskId, status: 'error', error: message });
  }
});

module.exports = router;
