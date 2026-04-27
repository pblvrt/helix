import path from 'path';

export interface PathConfig {
  projectDir: string;
  dataDir: string;
  runsDir: string;
  knowledgeDir: string;
  commandsDir: string;
  skillsDir: string;
  mcpJsonPath: string;
  schedulesPath: string;
  userConfigPath: string;
  dbPath: string;
}

export function createPathConfig(projectDir: string, dataDir: string): PathConfig {
  return {
    projectDir,
    dataDir,
    runsDir: path.join(dataDir, 'runs'),
    knowledgeDir: path.join(projectDir, '.claude', 'knowledge'),
    commandsDir: path.join(projectDir, '.claude', 'commands'),
    skillsDir: path.join(projectDir, '.claude', 'skills'),
    mcpJsonPath: path.join(projectDir, '.mcp.json'),
    schedulesPath: path.join(dataDir, 'schedules.json'),
    userConfigPath: path.join(dataDir, 'user-config.json'),
    dbPath: path.join(dataDir, 'app.db'),
  };
}
