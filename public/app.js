const API = '/api';
let ws = null;
let wsReconnectTimer = null;

const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const loginForm = document.getElementById('login-form');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const chatLog = document.getElementById('chat-log');
const promptForm = document.getElementById('prompt-form');
const promptInput = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const connStatus = document.getElementById('conn-status');
const taskTemplate = document.getElementById('task-template');
const badgeTemplate = document.getElementById('badge-template');

const taskEls = new Map();

function showApp() {
  loginScreen.hidden = true;
  appScreen.hidden = false;
  loadHistory();
  connectWs();
}

function showLogin() {
  appScreen.hidden = true;
  loginScreen.hidden = false;
}

async function checkAuth() {
  try {
    const res = await fetch(`${API}/me`);
    if (res.ok) showApp();
    else showLogin();
  } catch {
    showLogin();
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: loginPassword.value }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      loginError.textContent = data.error || 'Login failed';
      loginError.hidden = false;
      return;
    }
    loginPassword.value = '';
    showApp();
  } catch {
    loginError.textContent = 'Network error';
    loginError.hidden = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  await fetch(`${API}/auth/logout`, { method: 'POST' });
  if (ws) ws.close();
  taskEls.clear();
  chatLog.innerHTML = '';
  showLogin();
});

function createTaskEl(taskId, promptText) {
  const node = taskTemplate.content.cloneNode(true);
  const taskDiv = node.querySelector('.task');
  const userBubble = node.querySelector('.user-bubble');
  const badges = node.querySelector('.agent-badges');
  const assistantBubble = node.querySelector('.assistant-bubble');

  userBubble.textContent = promptText || '';
  taskDiv.dataset.taskId = taskId;

  chatLog.appendChild(node);
  const els = { taskDiv, userBubble, badges, assistantBubble, badgeMap: new Map() };
  taskEls.set(String(taskId), els);
  scrollToBottom();
  return els;
}

function getOrCreateTaskEl(taskId, promptText) {
  const key = String(taskId);
  if (taskEls.has(key)) return taskEls.get(key);
  return createTaskEl(taskId, promptText);
}

const AGENT_LABELS = {
  claude: 'Claude',
  free: 'Free (DeepSeek/Qwen)',
};

function upsertBadge(els, agent, status) {
  let badge = els.badgeMap.get(agent);
  if (!badge) {
    const node = badgeTemplate.content.cloneNode(true);
    badge = node.querySelector('.badge');
    badge.querySelector('.badge-name').textContent = AGENT_LABELS[agent] || agent;
    els.badges.appendChild(badge);
    els.badgeMap.set(agent, badge);
  }
  badge.dataset.status = status;
}

function setFinalAnswer(els, text, isError) {
  els.assistantBubble.hidden = false;
  els.assistantBubble.textContent = text;
  els.assistantBubble.classList.toggle('error-bubble', !!isError);
  scrollToBottom();
}

function scrollToBottom() {
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function loadHistory() {
  chatLog.innerHTML = '';
  taskEls.clear();
  try {
    const res = await fetch(`${API}/tasks`);
    if (!res.ok) return;
    const tasks = await res.json();
    if (tasks.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No tasks yet. Describe something below to get the agents working.';
      chatLog.appendChild(empty);
      return;
    }
    for (const task of tasks) {
      const detail = await fetch(`${API}/tasks/${task.id}`).then((r) => r.json());
      const els = createTaskEl(detail.id, detail.prompt);
      for (const run of detail.runs || []) {
        upsertBadge(els, run.agent, run.status);
      }
      if (detail.status === 'done' && detail.final_answer) {
        setFinalAnswer(els, detail.final_answer, false);
      } else if (detail.status === 'error') {
        setFinalAnswer(els, detail.error || 'Something went wrong.', true);
      }
    }
    scrollToBottom();
  } catch {
    /* history is best-effort */
  }
}

promptForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = promptInput.value.trim();
  if (!text) return;
  sendBtn.disabled = true;
  promptInput.value = '';
  autoGrow();
  try {
    const res = await fetch(`${API}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text }),
    });
    if (res.status === 401) return showLogin();
    const data = await res.json();
    if (res.ok) getOrCreateTaskEl(data.id, text);
  } catch {
    /* ignore */
  } finally {
    sendBtn.disabled = false;
  }
});

promptInput.addEventListener('input', autoGrow);
function autoGrow() {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 140) + 'px';
}

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    promptForm.requestSubmit();
  }
});

function connectWs() {
  clearTimeout(wsReconnectTimer);
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}/ws`);

  ws.addEventListener('open', () => {
    connStatus.classList.add('online');
    connStatus.classList.remove('offline');
  });

  ws.addEventListener('close', () => {
    connStatus.classList.remove('online');
    connStatus.classList.add('offline');
    wsReconnectTimer = setTimeout(connectWs, 2000);
  });

  ws.addEventListener('error', () => ws.close());

  ws.addEventListener('message', (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    handleWsMessage(data);
  });
}

function handleWsMessage(data) {
  if (data.type === 'agent_update' && data.taskId) {
    const els = getOrCreateTaskEl(data.taskId);
    upsertBadge(els, data.agent, data.status);
  } else if (data.type === 'task_update' && data.taskId) {
    const els = getOrCreateTaskEl(data.taskId);
    if (data.status === 'done' && data.finalAnswer) {
      setFinalAnswer(els, data.finalAnswer, false);
    } else if (data.status === 'error') {
      setFinalAnswer(els, data.error || 'Something went wrong.', true);
    }
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}

checkAuth();
