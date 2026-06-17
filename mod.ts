/**
 * CortexPrism Notion Sync Plugin
 *
 * Bidirectional sync between Cortex sessions and Notion — query databases,
 * create/update pages, search workspaces, and sync agent memories.
 *
 * #9 in the official plugin registry.
 */

import type { PluginContext, Tool, ToolCallResult, ToolContext } from './types.ts';

// ---------------------------------------------------------------------------
// Module-level config
// ---------------------------------------------------------------------------

interface NotionConfig {
  notionToken: string;
  defaultDatabaseId: string;
}

let config: NotionConfig = {
  notionToken: '',
  defaultDatabaseId: '',
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const DEFAULT_TIMEOUT = 15_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotionError {
  object: 'error';
  status: number;
  code: string;
  message: string;
}

interface NotionBlockRequest {
  object: string;
  type: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNotionHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${config.notionToken}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
    'User-Agent': 'CortexPrism-NotionSync/1.0.0',
  };
}

function didFail(msg: string): ToolCallResult {
  return { toolName: '', success: false, output: '', error: msg, durationMs: 0 };
}

async function notionRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    ...options,
    headers: { ...getNotionHeaders(), ...(options.headers as Record<string, string> || {}) },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });

  const body = await response.json();

  if (!response.ok) {
    const err = body as NotionError;
    throw new Error(`Notion API error (${response.status}): ${err.message || 'Unknown error'}`);
  }

  return body as T;
}

function extractPageTitle(page: Record<string, unknown>): string {
  try {
    const props = (page.properties || {}) as Record<string, unknown>;
    for (const [, value] of Object.entries(props)) {
      const v = value as Record<string, unknown>;
      if (v.type === 'title' && Array.isArray(v.title) && v.title.length > 0) {
        return (v.title as Array<{ plain_text: string }>).map((t) => t.plain_text).join('');
      }
    }
  } catch { /* fall through */ }
  return 'Untitled';
}

function extractDbTitle(db: Record<string, unknown>): string {
  try {
    const titleArr = db.title as Array<{ plain_text: string }>;
    if (titleArr && titleArr.length > 0) return titleArr.map((t) => t.plain_text).join('');
  } catch { /* fall through */ }
  return 'Untitled Database';
}

function markdownToBlocks(markdown: string): NotionBlockRequest[] {
  const blocks: NotionBlockRequest[] = [];
  const lines = markdown.split('\n');

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const content = line;

    if (content.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: content.replace('### ', '') } }],
        },
      });
    } else if (content.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: content.replace('## ', '') } }] },
      });
    } else if (content.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: { rich_text: [{ type: 'text', text: { content: content.replace('# ', '') } }] },
      });
    } else if (content.startsWith('- ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: content.replace('- ', '') } }],
        },
      });
    } else if (/^\d+\./.test(content)) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{ type: 'text', text: { content: content.replace(/^\d+\.\s*/, '') } }],
        },
      });
    } else {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content } }] },
      });
    }
  }

  return blocks;
}

function checkToken(): string | null {
  if (!config.notionToken) {
    return 'Notion integration token not configured. Set notionToken in plugin settings.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tool: notion_query_database
// ---------------------------------------------------------------------------

const notionQueryDatabase: Tool = {
  definition: {
    name: 'notion_query_database',
    description: 'Query a Notion database with filters and sorts.',
    params: [
      { name: 'database_id', type: 'string', description: 'Notion database ID', required: true },
      {
        name: 'filter',
        type: 'string',
        description: 'JSON string of Notion filter object',
        required: false,
      },
      {
        name: 'sorts',
        type: 'string',
        description: 'JSON string of Notion sorts array',
        required: false,
      },
      {
        name: 'page_size',
        type: 'number',
        description: 'Number of results per page (default: 100)',
        required: false,
      },
    ],
    capabilities: ['network:fetch'],
  },

  execute: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolCallResult> => {
    const start = Date.now();
    const toolName = 'notion_query_database';
    try {
      if (!args.database_id || typeof args.database_id !== 'string') {
        return didFail('database_id must be a non-empty string');
      }
      const tokenErr = checkToken();
      if (tokenErr) return didFail(tokenErr);

      const databaseId = args.database_id as string;
      const pageSize = Math.min((args.page_size as number) || 100, 100);

      const body: Record<string, unknown> = { page_size: pageSize };
      if (args.filter) {
        try {
          body.filter = JSON.parse(args.filter as string);
        } catch {
          return didFail('Invalid filter JSON');
        }
      }
      if (args.sorts) {
        try {
          body.sorts = JSON.parse(args.sorts as string);
        } catch {
          return didFail('Invalid sorts JSON');
        }
      }

      const result = await notionRequest<
        { results: Record<string, unknown>[]; has_more: boolean; next_cursor: string | null }
      >(
        `/databases/${databaseId}/query`,
        { method: 'POST', body: JSON.stringify(body) },
      );

      const pages = result.results.map((page) => ({
        id: page.id,
        title: extractPageTitle(page),
        url: (page.url as string) || `https://notion.so/${page.id}`,
        created_time: page.created_time,
        last_edited_time: page.last_edited_time,
        properties: page.properties || {},
      }));

      return {
        toolName,
        success: true,
        output: JSON.stringify({
          database_id: databaseId,
          pages,
          has_more: result.has_more,
          next_cursor: result.next_cursor,
        }),
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        toolName,
        success: false,
        output: '',
        error: `Database query failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool: notion_get_page
// ---------------------------------------------------------------------------

const notionGetPage: Tool = {
  definition: {
    name: 'notion_get_page',
    description: 'Retrieve a Notion page by ID with block content.',
    params: [
      { name: 'page_id', type: 'string', description: 'Notion page ID', required: true },
      {
        name: 'include_children',
        type: 'boolean',
        description: 'Include child blocks (default: true)',
        required: false,
      },
    ],
    capabilities: ['network:fetch'],
  },

  execute: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolCallResult> => {
    const start = Date.now();
    const toolName = 'notion_get_page';
    try {
      if (!args.page_id || typeof args.page_id !== 'string') {
        return didFail('page_id must be a non-empty string');
      }
      const tokenErr = checkToken();
      if (tokenErr) return didFail(tokenErr);

      const pageId = args.page_id as string;
      const includeChildren = args.include_children !== false;

      const page = await notionRequest<Record<string, unknown>>(`/pages/${pageId}`);

      let blocks: unknown[] = [];
      if (includeChildren) {
        const blockResult = await notionRequest<{ results: unknown[] }>(
          `/blocks/${pageId}/children?page_size=100`,
        );
        blocks = blockResult.results;
      }

      return {
        toolName,
        success: true,
        output: JSON.stringify({
          id: page.id,
          title: extractPageTitle(page),
          url: page.url,
          created_time: page.created_time,
          last_edited_time: page.last_edited_time,
          properties: page.properties,
          blocks,
        }),
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        toolName,
        success: false,
        output: '',
        error: `Page retrieval failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool: notion_create_page
// ---------------------------------------------------------------------------

const notionCreatePage: Tool = {
  definition: {
    name: 'notion_create_page',
    description: 'Create a new page in a Notion database or as a child page.',
    params: [
      {
        name: 'parent_id',
        type: 'string',
        description: 'Parent database ID or page ID',
        required: true,
      },
      {
        name: 'parent_type',
        type: 'string',
        description: 'Type of parent',
        required: true,
        enum: ['database', 'page'],
      },
      { name: 'title', type: 'string', description: 'Page title', required: true },
      {
        name: 'properties',
        type: 'string',
        description: 'JSON string of Notion page properties',
        required: false,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Markdown content for the page body',
        required: false,
      },
    ],
    capabilities: ['network:fetch'],
  },

  execute: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolCallResult> => {
    const start = Date.now();
    const toolName = 'notion_create_page';
    try {
      if (!args.parent_id || typeof args.parent_id !== 'string') {
        return didFail('parent_id must be a non-empty string');
      }
      if (!args.title || typeof args.title !== 'string') {
        return didFail('title must be a non-empty string');
      }
      if (args.parent_type !== 'database' && args.parent_type !== 'page') {
        return didFail("parent_type must be 'database' or 'page'");
      }
      const tokenErr = checkToken();
      if (tokenErr) return didFail(tokenErr);

      const parentId = args.parent_id as string;
      const parentType = args.parent_type as string;
      const title = args.title as string;

      const body: Record<string, unknown> = {
        parent: parentType === 'database' ? { database_id: parentId } : { page_id: parentId },
        properties: { title: { title: [{ type: 'text', text: { content: title } }] } },
      };

      if (args.properties) {
        try {
          Object.assign(
            body.properties as Record<string, unknown>,
            JSON.parse(args.properties as string),
          );
        } catch {
          return didFail('Invalid properties JSON');
        }
      }

      const page = await notionRequest<Record<string, unknown>>('/pages', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const pageId = page.id as string;

      if (args.content && typeof args.content === 'string' && args.content.trim()) {
        const blocks = markdownToBlocks(args.content as string);
        if (blocks.length > 0) {
          for (let i = 0; i < blocks.length; i += 100) {
            await notionRequest(`/blocks/${pageId}/children`, {
              method: 'PATCH',
              body: JSON.stringify({ children: blocks.slice(i, i + 100) }),
            });
          }
        }
      }

      return {
        toolName,
        success: true,
        output: JSON.stringify({
          id: pageId,
          title,
          url: `https://notion.so/${pageId.replace(/-/g, '')}`,
          created_time: page.created_time,
        }),
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        toolName,
        success: false,
        output: '',
        error: `Page creation failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool: notion_update_page
// ---------------------------------------------------------------------------

const notionUpdatePage: Tool = {
  definition: {
    name: 'notion_update_page',
    description: "Update an existing Notion page's properties and/or content.",
    params: [
      { name: 'page_id', type: 'string', description: 'Notion page ID to update', required: true },
      {
        name: 'properties',
        type: 'string',
        description: 'JSON string of properties to update',
        required: false,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Markdown content to append or replace',
        required: false,
      },
      {
        name: 'mode',
        type: 'string',
        description: 'How to handle content',
        required: false,
        enum: ['append', 'replace'],
      },
    ],
    capabilities: ['network:fetch'],
  },

  execute: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolCallResult> => {
    const start = Date.now();
    const toolName = 'notion_update_page';
    try {
      if (!args.page_id || typeof args.page_id !== 'string') {
        return didFail('page_id must be a non-empty string');
      }
      const tokenErr = checkToken();
      if (tokenErr) return didFail(tokenErr);

      const pageId = args.page_id as string;
      const mode = (args.mode as string) || 'append';

      if (args.properties && typeof args.properties === 'string') {
        let props: Record<string, unknown>;
        try {
          props = JSON.parse(args.properties);
        } catch {
          return didFail('Invalid properties JSON');
        }
        await notionRequest(`/pages/${pageId}`, {
          method: 'PATCH',
          body: JSON.stringify({ properties: props }),
        });
      }

      if (args.content && typeof args.content === 'string' && args.content.trim()) {
        const blocks = markdownToBlocks(args.content as string);
        if (blocks.length > 0) {
          await notionRequest(`/blocks/${pageId}/children`, {
            method: 'PATCH',
            body: JSON.stringify({ children: blocks.slice(0, 100) }),
          });
        }
      }

      return {
        toolName,
        success: true,
        output: JSON.stringify({ id: pageId, updated: true, mode }),
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        toolName,
        success: false,
        output: '',
        error: `Page update failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool: notion_search
// ---------------------------------------------------------------------------

const notionSearch: Tool = {
  definition: {
    name: 'notion_search',
    description: 'Search across the Notion workspace for pages and databases.',
    params: [
      { name: 'query', type: 'string', description: 'Search query text', required: true },
      {
        name: 'filter_type',
        type: 'string',
        description: 'Filter to only pages or databases',
        required: false,
        enum: ['page', 'database'],
      },
      {
        name: 'page_size',
        type: 'number',
        description: 'Number of results (default: 20)',
        required: false,
      },
    ],
    capabilities: ['network:fetch'],
  },

  execute: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolCallResult> => {
    const start = Date.now();
    const toolName = 'notion_search';
    try {
      if (!args.query || typeof args.query !== 'string') {
        return didFail('query must be a non-empty string');
      }
      const tokenErr = checkToken();
      if (tokenErr) return didFail(tokenErr);

      const query = args.query as string;
      const pageSize = Math.min((args.page_size as number) || 20, 100);
      const body: Record<string, unknown> = { query, page_size: pageSize };

      if (args.filter_type) body.filter = { property: 'object', value: args.filter_type };

      const result = await notionRequest<{ results: Record<string, unknown>[]; has_more: boolean }>(
        '/search',
        { method: 'POST', body: JSON.stringify(body) },
      );

      const items = result.results.map((item) => ({
        id: item.id,
        object: item.object,
        title: item.object === 'database' ? extractDbTitle(item) : extractPageTitle(item),
        url: item.url,
        last_edited_time: item.last_edited_time,
      }));

      return {
        toolName,
        success: true,
        output: JSON.stringify({ query, results: items, has_more: result.has_more }),
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        toolName,
        success: false,
        output: '',
        error: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool: notion_list_databases
// ---------------------------------------------------------------------------

const notionListDatabases: Tool = {
  definition: {
    name: 'notion_list_databases',
    description: 'List all databases accessible to the integration.',
    params: [
      {
        name: 'page_size',
        type: 'number',
        description: 'Number of results (default: 100)',
        required: false,
      },
    ],
    capabilities: ['network:fetch'],
  },

  execute: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolCallResult> => {
    const start = Date.now();
    const toolName = 'notion_list_databases';
    try {
      const tokenErr = checkToken();
      if (tokenErr) return didFail(tokenErr);

      const pageSize = Math.min((args.page_size as number) || 100, 100);

      const result = await notionRequest<{ results: Record<string, unknown>[]; has_more: boolean }>(
        '/search',
        {
          method: 'POST',
          body: JSON.stringify({
            filter: { property: 'object', value: 'database' },
            page_size: pageSize,
          }),
        },
      );

      const databases = result.results.map((db) => ({
        id: db.id,
        title: extractDbTitle(db),
        url: db.url as string,
        created_time: db.created_time,
        last_edited_time: db.last_edited_time,
      }));

      return {
        toolName,
        success: true,
        output: JSON.stringify({ databases, has_more: result.has_more }),
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        toolName,
        success: false,
        output: '',
        error: `List databases failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool: notion_sync_memory
// ---------------------------------------------------------------------------

const notionSyncMemory: Tool = {
  definition: {
    name: 'notion_sync_memory',
    description: 'Sync Cortex session memories to a Notion database.',
    params: [
      {
        name: 'database_id',
        type: 'string',
        description: 'Target Notion database ID',
        required: true,
      },
      {
        name: 'memories',
        type: 'string',
        description: 'JSON array of memory objects with title, content, tags, and timestamp',
        required: true,
      },
    ],
    capabilities: ['network:fetch'],
  },

  execute: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolCallResult> => {
    const start = Date.now();
    const toolName = 'notion_sync_memory';
    try {
      if (!args.database_id || typeof args.database_id !== 'string') {
        return didFail('database_id must be a non-empty string');
      }
      if (!args.memories || typeof args.memories !== 'string') {
        return didFail('memories must be a non-empty JSON string');
      }
      const tokenErr = checkToken();
      if (tokenErr) return didFail(tokenErr);

      const databaseId = args.database_id as string;

      let memories: Array<{ title: string; content: string; tags?: string[] }>;
      try {
        memories = JSON.parse(args.memories as string);
        if (!Array.isArray(memories)) throw new Error('memories must be an array');
      } catch {
        return didFail('Invalid memories JSON — must be an array of memory objects');
      }

      const created: string[] = [];
      const errors: string[] = [];

      for (const memory of memories) {
        try {
          if (!memory.title) continue;

          const body: Record<string, unknown> = {
            parent: { database_id: databaseId },
            properties: { title: { title: [{ type: 'text', text: { content: memory.title } }] } },
          };

          if (memory.tags && memory.tags.length > 0) {
            (body.properties as Record<string, unknown>)['Tags'] = {
              multi_select: memory.tags.map((tag: string) => ({ name: tag })),
            };
          }

          const page = await notionRequest<Record<string, unknown>>('/pages', {
            method: 'POST',
            body: JSON.stringify(body),
          });
          const pageId = page.id as string;

          if (memory.content) {
            const blocks = markdownToBlocks(memory.content);
            if (blocks.length > 0) {
              await notionRequest(`/blocks/${pageId}/children`, {
                method: 'PATCH',
                body: JSON.stringify({ children: blocks.slice(0, 100) }),
              });
            }
          }

          created.push(pageId);
        } catch (err) {
          errors.push(
            `Failed to sync "${memory.title}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      return {
        toolName,
        success: true,
        output: JSON.stringify({
          database_id: databaseId,
          synced: created.length,
          failed: errors.length,
          pageIds: created,
          errors: errors.length > 0 ? errors : undefined,
        }),
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        toolName,
        success: false,
        output: '',
        error: `Memory sync failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function onLoad(ctx: PluginContext): Promise<void> {
  const notionToken = await ctx.config.get<string>('notionToken');
  const defaultDatabaseId = await ctx.config.get<string>('defaultDatabaseId');

  config = {
    notionToken: notionToken ?? '',
    defaultDatabaseId: defaultDatabaseId ?? '',
  };

  ctx.logger.info('[cortex-plugin-notion] Loaded');
}

export async function onUnload(_ctx: PluginContext): Promise<void> {}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const tools: Tool[] = [
  notionQueryDatabase,
  notionGetPage,
  notionCreatePage,
  notionUpdatePage,
  notionSearch,
  notionListDatabases,
  notionSyncMemory,
];
