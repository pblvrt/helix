import { contextBridge, ipcRenderer } from 'electron';

const validInvokeChannels = [
  'app:version', 'app:check-update', 'app:install-update',
  'user-config:get', 'user-config:save', 'user-config:exists',
  'shell:open-path',
  'files:read', 'files:write',
  'shell:open-external',
  'actions:commands', 'actions:status', 'actions:submit', 'actions:stop', 'actions:stop-run', 'actions:queue',
  'actions:history', 'actions:get', 'actions:log', 'actions:stream-log',
  'schedules:list', 'schedules:create', 'schedules:update', 'schedules:delete',
  'goals:list', 'goals:get', 'goals:create', 'goals:update', 'goals:delete',
  'goals:start', 'goals:stop',
  'mcp:list', 'mcp:get', 'mcp:create', 'mcp:update', 'mcp:delete',
  'mcp:list-for-goal', 'mcp:set-for-goal',
  'tasks:list', 'tasks:counts', 'tasks:get', 'tasks:create', 'tasks:update', 'tasks:delete',
  'tasks:approve', 'tasks:decline',
  'chat:history', 'chat:clear',
  'agents:list', 'agents:get',
  'knowledge:list', 'knowledge:collections', 'knowledge:get',
  'knowledge:create', 'knowledge:update', 'knowledge:delete',
  'knowledge:revisions', 'knowledge:prompt',
  'skills:list', 'skills:get', 'skills:delete',
  'catalog:mcps:list', 'catalog:mcps:get', 'catalog:mcps:install',
  'catalog:skills:list', 'catalog:skills:get', 'catalog:skills:install',
  'catalog:jobs:state',
];

const validOnChannels = ['actions:stream'];

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel: string, ...args: unknown[]) => {
    if (!validInvokeChannels.includes(channel)) {
      throw new Error(`Invalid IPC channel: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    if (!validOnChannels.includes(channel)) {
      throw new Error(`Invalid IPC channel: ${channel}`);
    }
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  removeAllListeners: (channel: string) => {
    if (!validOnChannels.includes(channel)) {
      throw new Error(`Invalid IPC channel: ${channel}`);
    }
    ipcRenderer.removeAllListeners(channel);
  },
  openExternal: (url: string) => {
    ipcRenderer.invoke('shell:open-external', url);
  },
});
