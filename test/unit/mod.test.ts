import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { tools } from '../../mod.ts';
import type { PluginContext, ToolContext } from '../../types.ts';

// Mock PluginContext
const mockContext: PluginContext & ToolContext = {
  pluginId: 'cortex-plugin-notion',
  pluginDir: '/tmp/plugins/cortex-plugin-notion',
  state: {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    list: async () => ({}),
  },
  config: {
    get: async () => null,
    set: async () => {},
    getAll: async () => ({}),
  },
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
  host: {
    registerTool: () => {},
    unregisterTool: () => {},
  },
  sessionId: 'test-session',
  workingDir: '/tmp',
  agentId: 'test-agent',
  workspaceDir: '/tmp',
};

function findTool(name: string) {
  const tool = tools.find((t) => t.definition.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

Deno.test('tools array — exports all tools', () => {
  assertEquals(tools.length, 7);
  assertEquals(tools[0].definition.name, 'notion_query_database');
  assertEquals(tools[1].definition.name, 'notion_get_page');
  assertEquals(tools[2].definition.name, 'notion_create_page');
  assertEquals(tools[3].definition.name, 'notion_update_page');
  assertEquals(tools[4].definition.name, 'notion_search');
  assertEquals(tools[5].definition.name, 'notion_list_databases');
  assertEquals(tools[6].definition.name, 'notion_sync_memory');
});

Deno.test('notion_query_database — rejects empty database_id', async () => {
  const tool = findTool('notion_query_database');
  const result = await tool.execute({ 'database_id': '' }, mockContext);
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'non-empty string');
});

Deno.test('notion_get_page — rejects empty page_id', async () => {
  const tool = findTool('notion_get_page');
  const result = await tool.execute({ 'page_id': '' }, mockContext);
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'non-empty string');
});

Deno.test('notion_create_page — rejects empty parent_id', async () => {
  const tool = findTool('notion_create_page');
  const result = await tool.execute({ 'parent_id': '' }, mockContext);
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'non-empty string');
});

Deno.test('notion_update_page — rejects empty page_id', async () => {
  const tool = findTool('notion_update_page');
  const result = await tool.execute({ 'page_id': '' }, mockContext);
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'non-empty string');
});

Deno.test('notion_search — rejects empty query', async () => {
  const tool = findTool('notion_search');
  const result = await tool.execute({ 'query': '' }, mockContext);
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'non-empty string');
});

Deno.test('notion_list_databases — tool is defined with name and description', () => {
  const tool = findTool('notion_list_databases');
  assertEquals(typeof tool.definition.description, 'string');
  assertEquals(tool.definition.description.length > 0, true);
});

Deno.test('notion_sync_memory — rejects empty database_id', async () => {
  const tool = findTool('notion_sync_memory');
  const result = await tool.execute({ 'database_id': '' }, mockContext);
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'non-empty string');
});

Deno.test('all tools return durationMs', async () => {
  for (const tool of tools) {
    const args: Record<string, unknown> = {};
    const result = await tool.execute(args, mockContext);
    assertEquals(typeof result.durationMs, 'number');
    assertEquals(result.durationMs >= 0, true);
  }
});
