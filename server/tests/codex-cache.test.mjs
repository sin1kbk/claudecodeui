import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const projectsModuleUrl = new URL('../projects.js', import.meta.url).href;
let importNonce = 0;

async function importProjectsModule(homeDir) {
  process.env.HOME = homeDir;
  process.env.DATABASE_PATH = path.join(homeDir, '.cloudcli-test', 'auth.db');
  importNonce += 1;
  return import(`${projectsModuleUrl}?home=${encodeURIComponent(homeDir)}&ts=${Date.now()}-${importNonce}`);
}

async function createCodexSession(homeDir, projectPath, sessionId = 'session-1') {
  const sessionDir = path.join(homeDir, '.codex', 'sessions', '2026', '03', '30');
  await mkdir(sessionDir, { recursive: true });

  const sessionFile = path.join(sessionDir, `${sessionId}.jsonl`);
  const lines = [
    JSON.stringify({
      type: 'session_meta',
      timestamp: '2026-03-30T00:00:00.000Z',
      payload: {
        id: sessionId,
        cwd: projectPath,
        model: 'gpt-5.4',
      },
    }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-03-30T00:00:01.000Z',
      payload: {
        type: 'user_message',
        kind: 'plain',
        message: 'hello cache',
      },
    }),
  ];

  await writeFile(sessionFile, `${lines.join('\n')}\n`, 'utf8');
  return sessionFile;
}

async function createClaudeProject(homeDir, projectName, projectPath) {
  const projectDir = path.join(homeDir, '.claude', 'projects', projectName);
  await mkdir(projectDir, { recursive: true });

  const sessionFile = path.join(projectDir, 'session-1.jsonl');
  const lines = [
    JSON.stringify({
      sessionId: 'claude-session-1',
      timestamp: '2026-03-30T00:00:00.000Z',
      cwd: projectPath,
      type: 'summary',
      summary: 'cached claude project',
    }),
    JSON.stringify({
      sessionId: 'claude-session-1',
      timestamp: '2026-03-30T00:00:01.000Z',
      cwd: projectPath,
      message: {
        role: 'user',
        content: 'hello project cache',
      },
    }),
  ];

  await writeFile(sessionFile, `${lines.join('\n')}\n`, 'utf8');
  return projectDir;
}

test('getCodexSessions caches the global index until it is cleared', async () => {
  const originalHome = process.env.HOME;
  const originalDatabasePath = process.env.DATABASE_PATH;
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-codex-cache-'));
  const projectPath = path.join(homeDir, 'worktree', 'demo-project');

  try {
    const sessionFile = await createCodexSession(homeDir, projectPath);
    const projects = await importProjectsModule(homeDir);

    const firstRead = await projects.getCodexSessions(projectPath);
    assert.equal(firstRead.length, 1);
    assert.equal(firstRead[0].id, 'session-1');

    await rm(sessionFile);

    const cachedRead = await projects.getCodexSessions(projectPath);
    assert.equal(cachedRead.length, 1);
    assert.equal(cachedRead[0].id, 'session-1');

    projects.clearCodexSessionsIndexCache();

    const refreshedRead = await projects.getCodexSessions(projectPath);
    assert.deepEqual(refreshedRead, []);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = originalDatabasePath;
    }

    await rm(homeDir, { recursive: true, force: true });
  }
});

test('getProjects reuses the cached snapshot until caches are cleared', async () => {
  const originalHome = process.env.HOME;
  const originalDatabasePath = process.env.DATABASE_PATH;
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-project-cache-'));
  const projectPath = path.join(homeDir, 'worktree', 'demo-project');
  const projectName = 'demo-project';

  try {
    const projectDir = await createClaudeProject(homeDir, projectName, projectPath);
    const projects = await importProjectsModule(homeDir);

    const firstRead = await projects.getProjects();
    assert.equal(firstRead.length, 1);
    assert.equal(firstRead[0].name, projectName);

    await rm(projectDir, { recursive: true, force: true });

    const cachedRead = await projects.getProjects();
    assert.equal(cachedRead.length, 1);
    assert.equal(cachedRead[0].name, projectName);

    projects.clearProjectDirectoryCache();

    const refreshedRead = await projects.getProjects();
    assert.deepEqual(refreshedRead, []);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = originalDatabasePath;
    }

    await rm(homeDir, { recursive: true, force: true });
  }
});
