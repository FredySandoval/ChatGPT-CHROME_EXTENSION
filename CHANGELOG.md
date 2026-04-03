# Changelog

All notable changes from `8af6790d` (`Improve backup reliability and add stop-download flow`) to the current `HEAD` are documented here.

## Unreleased

### Added
- Added richer markdown/export formatting support for complex ChatGPT content.
- Added raw JSON export support.
- Added file citation rendering support in exports.
- Added project-aware backup flow for the current ChatGPT project.
- Added project backup actions in the popup UI.
- Added project conversation discovery through the content script.
- Added fallback content-script injection for project backup flows.
- Added promotional sections/links in the popup and options UI.

### Changed
- Improved default markdown labels and sizing in the popup and options pages.
- Updated USER / ASSISTANT label configuration with helper text and clearer defaults.
- Added frontmatter-related export and configuration updates.
- Refined popup layout and styling across several iterations.
- Extended service-worker export logic and backup orchestration.

### Fixed / Improved
- Improved rendering for rich exported content.
- Improved popup layout for export actions.
- Improved JSON-stringified debug logging for troubleshooting.
- Improved project-only action visibility when viewing project chats.

## Commit history

- `66c83c8` - Improve markdown label defaults and sizing
- `78f5cd3` - Improve export rendering for rich content
- `9062fc9` - Add raw JSON export and improve popup layout
- `4563b94` - Add file citation rendering support
- `2f7aead` - Update USER / ASSISTANT labels and helper text
- `903200f` - Update frontmatter support/configuration
- `c55c3e8` - Update popup styles/layout
- `072295d` - Minor popup style update
- `cf37ca5` - Popup/options update
- `c3ff278` - Service worker update
- `f6e3f98` - Add current project backup flow
- `96d7b4d` - Add promo content

## Notes

This changelog was generated from the Git history after:
- `8af6790d` - Improve backup reliability and add stop-download flow

Current head at generation time:
- `96d7b4d` - update: add promo
