# Privacy Policy

**ChatGPT Backup Tool** is a Chrome extension designed to help users export and back up their ChatGPT conversations.

## What data the extension accesses

The extension may access the following data on `https://chatgpt.com/*` when the user chooses to run an export:

- ChatGPT conversation content
- Project-related conversation content
- Page content needed to identify the current chat or project
- User-selected export settings stored in Chrome extension storage

## How the data is used

The extension uses data only to provide its core functionality, including:

- exporting the current chat
- exporting all chats
- exporting project chats
- generating Markdown, JSON, raw JSON, or ZIP exports
- applying user-selected formatting options such as markdown labels and frontmatter-related settings
- saving extension preferences for future exports

## Data storage

The extension stores user preferences locally using Chrome's extension storage APIs.

Examples of stored settings may include:
- markdown label settings
- formatting preferences
- frontmatter-related options
- other export configuration choices

Exported conversation files are downloaded directly to the user's device.

## Data sharing

This extension does **not** sell user data.

This extension does **not** transfer user data to third parties for advertising or unrelated purposes.

This extension does **not** use user data to determine creditworthiness or for lending purposes.

## Remote code

The extension does **not** use remote code. All executable code is packaged with the extension.

## Permissions used

The extension requests only the permissions needed for its single purpose of exporting ChatGPT conversations:

- `tabs` — to identify the active ChatGPT tab
- `downloads` — to save exported files to the user's device
- `storage` — to save user preferences and export settings
- `scripting` — to run required scripts on ChatGPT pages when needed
- host permission for `https://chatgpt.com/*` — to access ChatGPT pages and export user-selected conversations

## User control

The extension runs export actions only when the user chooses to use it.

Users control:
- when exports are started
- which chats are exported
- which format is used
- what settings are saved in the extension

## Contact and support

For questions, support, or source code, visit:

- GitHub repository: https://github.com/FredySandoval/ChatGPT-CHROME_EXTENSION
- Support / issues: https://github.com/FredySandoval/ChatGPT-CHROME_EXTENSION/issues
