# CortexPrism Notion Sync Plugin

Bidirectional sync between Cortex sessions and Notion — query databases, create and update pages,
search workspaces, and sync agent memories to Notion documents.

## Installation

```bash
cortex plugin install cortex-plugin-notion
```

Or install from local development:

```bash
git clone https://github.com/CortexPrism/cortex-plugin-notion.git
cd cortex-plugin-notion
cortex plugin install .
```

## Setup

### 1. Create a Notion Integration

1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Click **New integration**
3. Name it "CortexPrism" and select your workspace
4. Copy the **Internal Integration Secret** (starts with `secret_`)

### 2. Grant Database Access

For each database you want Cortex to access:

1. Open the database in Notion
2. Click `...` → **Connections** → Add your CortexPrism integration

### 3. Configure the Plugin

| Setting             | Type            | Default | Description                                        |
| ------------------- | --------------- | ------- | -------------------------------------------------- |
| `notionToken`       | string (secret) | —       | Notion integration token from my-integrations page |
| `defaultDatabaseId` | string          | —       | Default database ID for operations                 |

## Tools

### `notion_query_database`

Query a Notion database with filters and sorts.

```json
{
  "database_id": "abc123...",
  "filter": "{\"property\":\"Status\",\"select\":{\"equals\":\"In Progress\"}}",
  "page_size": 50
}
```

### `notion_get_page`

Retrieve a Notion page with all block content.

```json
{
  "page_id": "abc123...",
  "include_children": true
}
```

### `notion_create_page`

Create a new page in a database or as a standalone page.

```json
{
  "parent_id": "abc123...",
  "parent_type": "database",
  "title": "Meeting Notes: Q2 Planning",
  "content": "# Q2 Planning Meeting\n\n- Discussed roadmap priorities\n- Decided on feature freeze date"
}
```

### `notion_update_page`

Update an existing page's properties and/or content.

```json
{
  "page_id": "abc123...",
  "properties": "{\"Status\":{\"select\":{\"name\":\"Done\"}}}",
  "content": "\n## Action Items\n- [x] Review architecture doc\n- [ ] Schedule follow-up",
  "mode": "append"
}
```

### `notion_search`

Search across the Notion workspace.

```json
{
  "query": "Q2 roadmap",
  "filter_type": "page",
  "page_size": 20
}
```

### `notion_list_databases`

List all databases accessible to the integration.

```json
{ "page_size": 50 }
```

### `notion_sync_memory`

Sync Cortex session memories to a Notion database.

```json
{
  "database_id": "abc123...",
  "memories": "[{\"title\":\"Auth service refactor\",\"content\":\"Refactored the auth service to use JWT...\",\"tags\":[\"backend\",\"security\"]}]"
}
```

## Usage Example

```
> Find all open tasks in the Sprint Board and create a summary

1. notion_query_database → { database_id: "sprint-db", filter: { Status: "In Progress" } }
→ Returns 8 matching tasks

2. notion_create_page → { title: "Sprint Status Summary", content: "..." }
→ Summary page created in wiki database
```

## Capabilities

| Capability      | Purpose                                                             |
| --------------- | ------------------------------------------------------------------- |
| `network:fetch` | Notion API access for database queries, page management, and search |

## Development

```bash
deno task test
deno fmt && deno lint

# Test with your Notion token
cortex plugin call cortex-plugin-notion notion_search '{"query":"test"}'
```

## License

MIT
