# Changelog — Notion Sync Plugin

## [1.0.0] — 2026-06-15

### Added
- Initial plugin scaffold: bidirectional Cortex ↔ Notion sync
- **7 tools**: `notion_query_database`, `notion_get_page`, `notion_create_page`, `notion_update_page`, `notion_search`, `notion_list_databases`, `notion_sync_memory`
- Full Notion API integration (2022-06-28 API version)
- Markdown-to-Notion-blocks converter (headings, lists, paragraphs, quotes)
- Memory sync: batch-create Notion pages from Cortex session memories with tag support
- Database query with JSON filter and sort support
- Page content retrieval with child block inclusion
- Workspace search with type filtering (pages vs databases)

### Changed
- (v1.0.0-rc1) Refactored to use spec-compliant `ToolContext` in all execute functions
- (v1.0.0-rc1) Moved Notion token to `onLoad` lifecycle hook (never hardcoded)
- (v1.0.0-rc1) Fixed manifest `ui.settings` with `secret` type for token, organized in sections
- (v1.0.0-rc1) Removed non-existent `permissions` manifest field

### Dependencies
- Cortex >=1.0.0
- Deno v2.0+ runtime
- Notion Integration Token (from my-integrations page)
