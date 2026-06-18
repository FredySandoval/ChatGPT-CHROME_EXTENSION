# Privacy Policy — ChatGPT Backup

**ChatGPT Backup** is a Chrome extension designed to help users export and back up their own ChatGPT conversations to local files.

## What data the extension accesses

The extension may access the following data on `https://chatgpt.com/*` only when the user chooses to run an export:

- ChatGPT conversation titles and message content
- ChatGPT conversation metadata needed to create exports
- Project-related conversation identifiers and project conversation content
- Page content needed to identify the current chat or current project
- The active ChatGPT session response needed to request the user's own conversations from ChatGPT
- User-selected export settings stored in Chrome extension storage

## How the data is used

The extension uses accessed data only to provide its core export functionality, including:

- exporting the current chat
- exporting all chats
- exporting project chats
- generating Markdown, MDX, JSON, raw JSON, or ZIP exports
- applying user-selected formatting options such as Markdown labels and MDX frontmatter
- saving extension preferences for future exports
- showing export progress and cancellation status

## Data storage

The extension stores only user preferences using Chrome extension storage APIs.

Examples of stored settings may include:

- export offsets / maximum chat count
- Markdown user and assistant label settings
- Markdown or MDX file extension preference
- MDX frontmatter template
- auto-advance preference
- detected color scheme

Exported conversation files are downloaded directly to the user's device through Chrome's downloads API.

## Authentication/session tokens

The extension may temporarily read the active ChatGPT session access token from ChatGPT's own session endpoint in order to request the user's conversations from ChatGPT on the user's behalf after the user initiates an export.

The extension does **not** persist ChatGPT access tokens in `chrome.storage.sync`, `chrome.storage.local`, or other durable extension storage. Token material is kept only in service-worker memory while needed and may be cleared when a token expires, an export fails with authorization errors, or the service worker is suspended by Chrome.

## Data sharing

This extension does **not** sell user data.

This extension does **not** share, transfer, or transmit ChatGPT conversation data to the developer or third-party analytics services.

This extension does **not** transfer user data to third parties for advertising or unrelated purposes.

This extension does **not** use user data to determine creditworthiness or for lending purposes.

If a user later uploads, shares, opens, or processes exported files in another application, that is outside the extension's control.

## Remote code and analytics

The extension does **not** use remote executable code. All executable code is packaged with the extension.

The extension does **not** include analytics tracking.

## Network requests

The extension makes requests to `https://chatgpt.com/*` to retrieve the user's own ChatGPT session and conversation data after the user initiates an export.

## Permissions used

The extension requests only the permissions needed for its single purpose of exporting ChatGPT conversations:

- `activeTab` — used to identify the currently active ChatGPT tab and determine whether the user is viewing a normal conversation or project conversation.
- `downloads` — used to save exported JSON, raw JSON, Markdown, MDX, and ZIP files to the user's device.
- `storage` — used to save user preferences and export settings.
- host permission for `https://chatgpt.com/*` — used to access ChatGPT pages and ChatGPT API responses needed to export the user's own conversations after the user initiates a backup.

## User control

The extension runs export actions only when the user chooses to use it.

Users control:

- when exports are started
- whether to export the current chat, all chats, or project chats
- which export format is used
- what formatting settings are saved in the extension
- whether to stop a long-running backup and download a partial result

## Contact and support

For questions or support, use the support channel listed on the Chrome Web Store listing or visit:

- GitHub repository: https://github.com/FredySandoval/ChatGPT-CHROME_EXTENSION
- Support / issues: https://github.com/FredySandoval/ChatGPT-CHROME_EXTENSION/issues
