const claude = require('./agents/claude');
const gemini = require('./agents/gemini');
const gpt = require('./agents/gpt');
const db = require('./db');

const AGENTS = { claude, gemini, gpt };

const SPLIT_SYSTEM = `You are a task orchestrator manager for a multi-agent AI system with three worker agents: "claude", "gemini", and "gpt".
Given a user task, break it into 1 to 3 parallel subtasks that independent agents can work on at the same time. If the task is simple or doesn't benefit from splitting, return a single subtask assigned to "claude".
Respond with ONLY valid JSON, no prose, no markdown code fences, in exactly this shape:
{"subtasks":[{"agent":"claude","instruction":"..."}]}
Rules:
- "agent" must be one of: "claude", "gemini", "gpt".
- Use each agent at most once.
- Each "instruction" must be a complete, self-contained instruction (the worker agent cannot see the original task or other subtasks).`;

const MERGE_SYSTEM = `You are a synthesis assistant for a multi-agent AI system. You receive a user's original task plus the raw outputs from one or more worker agents that each handled part of it.
Combine them into a single, clear, well-organized final answer for the user. Resolve or note any disagreements between agents. Do not reference internal agent names or system mechanics unless directly useful. Respond in plain markdown text only, no JSON.`;

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('orchestrator: no JSON object found in split response');
  return JSON.parse(match[0]);
}

async function splitTask(prompt) {
  const { output, error } = await claude.run(prompt, { system: SPLIT_SYSTEM, maxTokens: 1024 });
  if (error) throw new Error(`split failed: ${error}`);
  let parsed;
  try {
    parsed = extractJson(output);
  } catch {
    parsed = { subtasks: [{ agent: 'claude', instruction: prompt }] };
  }
  const subtasks = Array.isArray(parsed.subtasks)
    ? parsed.subtasks.filter((s) => s && AGENTS[s.agent] && s.instruction)
    : [];
  if (subtasks.length === 0) {
    return [{ agent: 'claude', instruction: prompt }];
  }
  const seen = new Set();
  return subtasks.filter((s) => {
    if (seen.has(s.agent)) return false;
    seen.add(s.agent);
    return true;
  });
}

function insertRun(taskId, agent, instruction) {
  return db
    .prepare(
      `INSERT INTO agent_runs (task_id, agent, subtask, status, started_at)
       VALUES (?, ?, ?, 'running', datetime('now'))`
    )
    .run(taskId, agent, instruction).lastInsertRowid;
}

function finishRun(runId, status, output, error) {
  db.prepare(
    `UPDATE agent_runs SET status = ?, output = ?, error = ?, finished_at = datetime('now') WHERE id = ?`
  ).run(status, output, error, runId);
}

async function runSubtasks(taskId, subtasks, onUpdate) {
  const runs = subtasks.map((s) => {
    const runId = insertRun(taskId, s.agent, s.instruction);
    onUpdate && onUpdate({ runId, agent: s.agent, status: 'running', subtask: s.instruction });
    return { runId, agent: s.agent, instruction: s.instruction };
  });

  const settled = await Promise.allSettled(runs.map((r) => AGENTS[r.agent].run(r.instruction)));

  return runs.map((r, i) => {
    const outcome = settled[i];
    const output = outcome.status === 'fulfilled' ? outcome.value.output : null;
    const error =
      outcome.status === 'fulfilled' ? outcome.value.error : outcome.reason?.message || String(outcome.reason);
    const status = error ? 'error' : 'done';
    finishRun(r.runId, status, output, error);
    onUpdate && onUpdate({ runId: r.runId, agent: r.agent, status, output, error, subtask: r.instruction });
    return { agent: r.agent, instruction: r.instruction, output, error, status };
  });
}

async function mergeResults(prompt, results) {
  const summary = results
    .map(
      (r) =>
        `### Agent: ${r.agent}\nSubtask: ${r.instruction}\n${
          r.error ? `Error: ${r.error}` : `Output:\n${r.output}`
        }`
    )
    .join('\n\n');
  const mergePrompt = `Original task:\n${prompt}\n\nAgent results:\n${summary}\n\nWrite the final combined answer for the user now.`;
  const { output, error } = await claude.run(mergePrompt, { system: MERGE_SYSTEM, maxTokens: 4096 });
  if (error) throw new Error(`merge failed: ${error}`);
  return output;
}

async function orchestrate(taskId, prompt, onUpdate) {
  db.prepare(`UPDATE tasks SET status = 'splitting', updated_at = datetime('now') WHERE id = ?`).run(taskId);
  const subtasks = await splitTask(prompt);

  db.prepare(`UPDATE tasks SET status = 'running', updated_at = datetime('now') WHERE id = ?`).run(taskId);
  const results = await runSubtasks(taskId, subtasks, onUpdate);

  db.prepare(`UPDATE tasks SET status = 'merging', updated_at = datetime('now') WHERE id = ?`).run(taskId);
  const finalAnswer = await mergeResults(prompt, results);

  db.prepare(
    `UPDATE tasks SET status = 'done', final_answer = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(finalAnswer, taskId);

  return finalAnswer;
}

module.exports = { orchestrate, AGENTS };
