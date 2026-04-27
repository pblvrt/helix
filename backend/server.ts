import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

import { openDatabase } from './core/db.js';
import { createPathConfig } from './core/paths.js';
import { createUserConfigRepository } from './modules/config/user-config.model.js';
import { createSchedulesRepository } from './modules/schedules/schedules.model.js';
import { createActionsRepository } from './modules/actions/actions.model.js';
import { createGoalsRepository } from './modules/goals/goals.model.js';
import { createMcpRepository } from './modules/mcp/mcp.model.js';
import { createJobManager } from './modules/actions/job-manager.js';
import { createGoalRunner } from './modules/goals/goal-runner.js';
import { createScheduler } from './modules/schedules/scheduler.js';
import { createConfigController } from './modules/config/config.controller.js';
import { createActionsController, createActionStreamRoute } from './modules/actions/actions.controller.js';
import { createGoalsController } from './modules/goals/goals.controller.js';
import { createMcpController } from './modules/mcp/mcp.controller.js';
import { createSchedulesController } from './modules/schedules/schedules.controller.js';
import { createTasksRepository } from './modules/tasks/tasks.model.js';
import { createTasksController } from './modules/tasks/tasks.controller.js';
import { createAgentsRepository } from './modules/agents/agents.model.js';
import { createAgentsController } from './modules/agents/agents.controller.js';
import { createKnowledgeRepository } from './modules/knowledge/knowledge.model.js';
import { createKnowledgeController } from './modules/knowledge/knowledge.controller.js';
import { createChatRepository } from './modules/chat/chat.model.js';
import { createChatService } from './modules/chat/chat.service.js';
import { createChatController } from './modules/chat/chat.controller.js';
import { runKnowledgeSeed } from './modules/knowledge/knowledge.seed.js';
import { importMcpJsonIfEmpty } from './modules/mcp/mcp-sync.js';
import { startMcpRefresher } from './modules/mcp/mcp-refresh.js';
import { createSkillsRepository } from './modules/skills/skills.model.js';
import { createSkillsController } from './modules/skills/skills.controller.js';
import { createHttpCache } from './modules/catalog/http-cache.js';
import { createMcpCatalog } from './modules/catalog/mcp-catalog.model.js';
import { createSkillCatalog } from './modules/catalog/skill-catalog.model.js';
import { createCatalogController, createCatalogService } from './modules/catalog/catalog.controller.js';
import { createFilesRepository } from './modules/files/files.model.js';
import { createFilesController } from './modules/files/files.controller.js';

import { mountRoutes, mountStreamRoutes } from './mount.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Fix PATH — ensure spawned agent processes can find node, claude, etc.
// ---------------------------------------------------------------------------

const home = os.homedir();
const extraPaths = [
  path.join(home, '.local', 'bin'),
  '/usr/local/bin',
  '/opt/homebrew/bin',
  path.join(home, '.npm-global', 'bin'),
  path.join(home, '.bun', 'bin'),
].filter(d => {
  try { return fs.existsSync(d); } catch { return false; }
});
if (extraPaths.length) {
  const cur = process.env.PATH || '';
  process.env.PATH = [...extraPaths.filter(d => !cur.includes(d)), cur].join(':');
}
try {
  const nvmDir = path.join(home, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmDir)) {
    const versions = fs.readdirSync(nvmDir).sort().reverse();
    if (versions[0]) {
      const binDir = path.join(nvmDir, versions[0], 'bin');
      if (fs.existsSync(binDir) && !process.env.PATH!.includes(binDir)) {
        process.env.PATH = `${binDir}:${process.env.PATH}`;
      }
    }
  }
} catch {}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

const PROJECT_DIR = path.join(__dirname, '..');
const paths = createPathConfig(PROJECT_DIR, path.join(PROJECT_DIR, 'data'));
const db = openDatabase(paths.dbPath);

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
  // Headless server can't pop the user's browser; the authorize URL will be
  // surfaced via the install stream and the frontend can window.open it.
  openUrl: (url: string) => console.log(`[catalog] open ${url}`),
});
const catalogWiring = createCatalogController(catalogService);

const mcpRefresher = startMcpRefresher({ mcp: mcpRepo, paths });
process.on('SIGINT',  () => { mcpRefresher.stop(); process.exit(0); });
process.on('SIGTERM', () => { mcpRefresher.stop(); process.exit(0); });

const jobManager = createJobManager({ db, paths, actionsRepo, goalsRepo });
const goalRunner = createGoalRunner({ db, paths, goalsRepo, jobManager, mcpRepo });
goalRunner.recover();

const chatRepo = createChatRepository(db);
const chatService = createChatService({ db, paths, chatRepo, tasksRepo, goalsRepo, knowledgeRepo, jobManager });
const chatWiring = createChatController({ chatService });

const scheduler = createScheduler({
  getSchedules: () => schedulesRepo.list(),
  submitJob: (command) => jobManager.submit(command),
  updateRunStatus: (id, status, runId) => schedulesRepo.updateRunStatus(id, status, runId),
});
scheduler.init();

// ---------------------------------------------------------------------------
// Express
// ---------------------------------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json());

mountRoutes(app, [
  ...createConfigController({ userConfig: userConfigRepo }),
  ...createActionsController({ actionsRepo, jobManager, db, paths }),
  ...createGoalsController({ goals: goalsRepo, goalRunner }),
  ...createMcpController({ mcp: mcpRepo, paths }),
  ...createSchedulesController({ schedulesRepo, actionsRepo, scheduler }),
  ...createTasksController({ tasksRepo }),
  ...createAgentsController({ agentsRepo }),
  ...createKnowledgeController({ knowledge: knowledgeRepo }),
  ...createFilesController({ files: filesRepo }),
  ...createSkillsController({ skills: skillsRepo }),
  ...catalogWiring.routes,
  ...chatWiring.routes,
]);

mountStreamRoutes(app, [
  createActionStreamRoute({ db, paths }),
  ...catalogWiring.streamRoutes,
  ...chatWiring.streamRoutes,
]);

const PORT = 3458;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
