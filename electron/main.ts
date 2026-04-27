import { app, BrowserWindow, ipcMain, dialog, Notification, shell } from 'electron';
import path from 'path';
import fs from 'fs';

import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
import log from 'electron-log';

// --- Core ---
import { openDatabase } from '../backend/core/db.js';
import { createPathConfig } from '../backend/core/paths.js';
import type { LogEntry } from '../backend/core/types.js';

// --- Modules ---
import { createUserConfigRepository } from '../backend/modules/config/user-config.model.js';
import { createSchedulesRepository } from '../backend/modules/schedules/schedules.model.js';
import { createActionsRepository } from '../backend/modules/actions/actions.model.js';
import { createJobManager } from '../backend/modules/actions/job-manager.js';
import { createScheduler } from '../backend/modules/schedules/scheduler.js';
import { createGoalsRepository } from '../backend/modules/goals/goals.model.js';
import { createGoalRunner } from '../backend/modules/goals/goal-runner.js';
import { createMcpRepository } from '../backend/modules/mcp/mcp.model.js';
import { createTasksRepository } from '../backend/modules/tasks/tasks.model.js';
import { createAgentsRepository } from '../backend/modules/agents/agents.model.js';
import { createKnowledgeRepository } from '../backend/modules/knowledge/knowledge.model.js';
import { runKnowledgeSeed } from '../backend/modules/knowledge/knowledge.seed.js';
import { importMcpJsonIfEmpty } from '../backend/modules/mcp/mcp-sync.js';
import { startMcpRefresher } from '../backend/modules/mcp/mcp-refresh.js';
import { createSkillsRepository } from '../backend/modules/skills/skills.model.js';
import { createHttpCache } from '../backend/modules/catalog/http-cache.js';
import { createMcpCatalog } from '../backend/modules/catalog/mcp-catalog.model.js';
import { createSkillCatalog } from '../backend/modules/catalog/skill-catalog.model.js';
import { createFilesRepository } from '../backend/modules/files/files.model.js';

// --- Adapters ---
import { registerIpcHandlers } from './ipc-bridge.js';
import { createHttpServer } from './mount-http.js';

// --- Controllers (mounted on the embedded HTTP server so agent CLIs can curl) ---
import { createConfigController } from '../backend/modules/config/config.controller.js';
import { createActionsController } from '../backend/modules/actions/actions.controller.js';
import { createGoalsController } from '../backend/modules/goals/goals.controller.js';
import { createMcpController } from '../backend/modules/mcp/mcp.controller.js';
import { createTasksController } from '../backend/modules/tasks/tasks.controller.js';
import { createAgentsController } from '../backend/modules/agents/agents.controller.js';
import { createKnowledgeController } from '../backend/modules/knowledge/knowledge.controller.js';
import { createChatRepository } from '../backend/modules/chat/chat.model.js';
import { createChatService } from '../backend/modules/chat/chat.service.js';
import { createChatController } from '../backend/modules/chat/chat.controller.js';
import { createSkillsController } from '../backend/modules/skills/skills.controller.js';
import { createCatalogController, createCatalogService } from '../backend/modules/catalog/catalog.controller.js';
import { createFilesController } from '../backend/modules/files/files.controller.js';

// ---------------------------------------------------------------------------
// PATH — Electron doesn't inherit the user's shell PATH on macOS/Linux.
// ---------------------------------------------------------------------------

function fixPath() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const extraDirs = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.fnm', 'aliases', 'default', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.yarn', 'bin'),
    path.join(home, '.bun', 'bin'),
  ];

  const nvmDir = path.join(home, '.nvm', 'versions', 'node');
  try {
    if (fs.existsSync(nvmDir)) {
      const aliasPath = path.join(home, '.nvm', 'alias', 'default');
      let targetVersion = '';
      try {
        const alias = fs.readFileSync(aliasPath, 'utf-8').trim();
        const versions = fs.readdirSync(nvmDir).sort().reverse();
        targetVersion = versions.find(v => v.includes(alias.replace('v', ''))) || versions[0] || '';
      } catch {
        const versions = fs.readdirSync(nvmDir).sort().reverse();
        targetVersion = versions[0] || '';
      }
      if (targetVersion) extraDirs.push(path.join(nvmDir, targetVersion, 'bin'));
    }
  } catch {}

  const currentPath = process.env.PATH || '';
  const newDirs = extraDirs.filter(d => {
    try { return fs.existsSync(d) && !currentPath.includes(d); } catch { return false; }
  });
  if (newDirs.length > 0) process.env.PATH = [...newDirs, currentPath].join(':');
}

fixPath();

// ---------------------------------------------------------------------------
// Paths & Database
// ---------------------------------------------------------------------------

const APP_NAME = 'seo-automator';
const PROJECT_DIR = app.isPackaged ? process.resourcesPath : app.getAppPath();
// In dev, use the repo's data/ directory so seeded files (schedules.json,
// directories.json, analytics/, keyword-queue/) live alongside the source.
// In the packaged app, use Application Support for user data.
const DATA_DIR = app.isPackaged
  ? path.join(app.getPath('appData'), APP_NAME)
  : path.join(PROJECT_DIR, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

const paths = createPathConfig(PROJECT_DIR, DATA_DIR);
const db = openDatabase(paths.dbPath);

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

const userConfigRepo = createUserConfigRepository({ db, paths });
const schedulesRepo = createSchedulesRepository(paths);
const actionsRepo = createActionsRepository(db, paths);
const goalsRepo = createGoalsRepository(db, paths.runsDir);
const mcpRepo = createMcpRepository(db);
importMcpJsonIfEmpty(paths, mcpRepo);
const tasksRepo = createTasksRepository(db);
const agentsRepo = createAgentsRepository(paths);
const knowledgeRepo = createKnowledgeRepository(db);
runKnowledgeSeed(db, paths);
const filesRepo = createFilesRepository(paths);
const skillsRepo = createSkillsRepository(paths);
const httpCache = createHttpCache(db);
const mcpCatalog = createMcpCatalog({ cache: httpCache, mcp: mcpRepo });
const skillCatalog = createSkillCatalog({ cache: httpCache, paths });
const catalogService = createCatalogService({
  mcpCatalog, skillCatalog, mcp: mcpRepo, skills: skillsRepo, paths,
  openUrl: (url: string) => { void shell.openExternal(url); },
});
const catalogWiring = createCatalogController(catalogService);

// Background OAuth token refresher — ticks every 60s, rewrites .mcp.json when
// any bearer token gets rotated.
const mcpRefresher = startMcpRefresher({ mcp: mcpRepo, paths });
app.on('before-quit', () => mcpRefresher.stop());

// ---------------------------------------------------------------------------
// Job Manager + Goal Runner + Scheduler
// ---------------------------------------------------------------------------

const jobManager = createJobManager({ db, paths, actionsRepo, goalsRepo });
const goalRunner = createGoalRunner({ db, paths, goalsRepo, jobManager, mcpRepo });
goalRunner.recover();

const chatRepo = createChatRepository(db);
const chatService = createChatService({ db, paths, chatRepo, tasksRepo, goalsRepo, knowledgeRepo, jobManager });
const chatWiring = createChatController({ chatService });

// Stream every log line to any renderer window
jobManager.emitter.on('job:entry', (_actionId: string, entry: LogEntry) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('actions:stream', entry);
  }
});

const scheduler = createScheduler({
  getSchedules: () => schedulesRepo.list(),
  submitJob: (command) => jobManager.submit(command),
  updateRunStatus: (id, status, runId) => schedulesRepo.updateRunStatus(id, status, runId),
});
scheduler.init();

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

registerIpcHandlers({
  db,
  userConfigRepo,
  schedulesRepo,
  actionsRepo,
  jobManager,
  goalRunner,
  scheduler,
  goalsRepo,
  mcpRepo,
  tasksRepo,
  agentsRepo,
  knowledgeRepo,
  filesRepo,
  skillsRepo,
  catalogService,
  paths,
  chatService,
});

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('shell:open-external', (_, url: string) => shell.openExternal(url));

let updateState: 'checking' | 'up-to-date' | 'update-available' | 'update-downloaded' = 'checking';
ipcMain.handle('app:check-update', () => updateState);
ipcMain.handle('app:install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

// Per-action log streaming for the Activity tab
let activeStreamWatcher: ReturnType<typeof setInterval> | null = null;

ipcMain.handle('actions:stream-log', (event, actionId: string) => {
  const row = db.prepare('SELECT * FROM actions WHERE id = ?').get(actionId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Action not found');

  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;

  if (activeStreamWatcher) { clearInterval(activeStreamWatcher); activeStreamWatcher = null; }

  const logPath = path.join(paths.runsDir, `${actionId}.jsonl`);

  if (fs.existsSync(logPath)) {
    const existing = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of existing) {
      try { win.webContents.send('actions:stream', JSON.parse(line)); } catch {}
    }
  }

  if (row.status !== 'running') {
    win.webContents.send('actions:stream', {
      type: 'status',
      data: { status: row.status, exitCode: row.exit_code },
      timestamp: Date.now(),
    });
    return;
  }

  let lastSize = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
  activeStreamWatcher = setInterval(() => {
    if (!fs.existsSync(logPath)) return;
    const currentSize = fs.statSync(logPath).size;
    if (currentSize > lastSize) {
      const fd = fs.openSync(logPath, 'r');
      const buf = Buffer.alloc(currentSize - lastSize);
      fs.readSync(fd, buf, 0, buf.length, lastSize);
      fs.closeSync(fd);
      lastSize = currentSize;

      for (const line of buf.toString().trim().split('\n').filter(Boolean)) {
        try {
          if (!win.isDestroyed()) win.webContents.send('actions:stream', JSON.parse(line));
        } catch {}
      }
    }

    const current = db.prepare('SELECT status, exit_code FROM actions WHERE id = ?').get(actionId) as Record<string, unknown> | undefined;
    if (current && current.status !== 'running') {
      if (!win.isDestroyed()) {
        win.webContents.send('actions:stream', {
          type: 'status',
          data: { status: current.status, exitCode: current.exit_code },
          timestamp: Date.now(),
        });
      }
      if (activeStreamWatcher) { clearInterval(activeStreamWatcher); activeStreamWatcher = null; }
    }
  }, 500);

  win.on('closed', () => {
    if (activeStreamWatcher) { clearInterval(activeStreamWatcher); activeStreamWatcher = null; }
  });
});

// ---------------------------------------------------------------------------
// Embedded HTTP API (for agent curl access)
// ---------------------------------------------------------------------------

const API_PORT = 3458;

const apiServer = createHttpServer(
  [
    ...createConfigController({ userConfig: userConfigRepo }),
    ...createActionsController({ actionsRepo, jobManager, db, paths }),
    ...createGoalsController({ goals: goalsRepo, goalRunner }),
    ...createMcpController({ mcp: mcpRepo, paths }),
    ...createTasksController({ tasksRepo }),
    ...createAgentsController({ agentsRepo }),
    ...createKnowledgeController({ knowledge: knowledgeRepo }),
    ...createFilesController({ files: filesRepo }),
    ...createSkillsController({ skills: skillsRepo }),
    ...catalogWiring.routes,
    ...chatWiring.routes,
  ],
  async (req, res, url) => {
    if (url.pathname === '/api/version' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ version: app.getVersion() }));
      return true;
    }
    return false;
  },
  [...chatWiring.streamRoutes],
);

// ---------------------------------------------------------------------------
// Auto-Updater
// ---------------------------------------------------------------------------

function setupAutoUpdater() {
  autoUpdater.logger = log;
  (autoUpdater.logger as typeof log).transports.file.level = 'info';
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info.version);
    updateState = 'update-available';
  });
  autoUpdater.on('update-not-available', () => {
    log.info('App is up to date.');
    updateState = 'up-to-date';
  });
  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info.version);
    updateState = 'update-downloaded';
    const notification = new Notification({
      title: 'Update Ready',
      body: `Version ${info.version} has been downloaded. Restart to apply.`,
    });
    notification.on('click', () => autoUpdater.quitAndInstall(false, true));
    notification.show();

    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'The update will be installed when you quit the app, or you can restart now.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then((result) => {
      if (result.response === 0) autoUpdater.quitAndInstall(false, true);
    });
  });
  autoUpdater.on('error', (error) => log.error('Auto-updater error:', error));
  autoUpdater.checkForUpdates().catch((err) => log.error('Update check failed:', err));
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    backgroundColor: '#ffffff',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  apiServer.listen(API_PORT, () => console.log(`Embedded API on port ${API_PORT}`));
  createWindow();
  if (app.isPackaged) setupAutoUpdater();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
