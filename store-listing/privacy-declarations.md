# Chrome Web Store Privacy Declarations Draft

Use this file as a reference when completing the Chrome Web Store privacy form. The wording here must stay aligned with `PRIVACY.md` and the actual implementation.

## Single purpose

ChatGPT Backup helps users export and back up their own ChatGPT conversations to local files.

## Data accessed / collected

The extension may access ChatGPT conversation data only after the user initiates an export. This may include:

- conversation titles
- message content
- conversation metadata
- project-related conversation identifiers
- project conversation content
- active ChatGPT page information needed to identify the current chat or project
- ChatGPT session response data needed to request the user's own conversations from ChatGPT

## Data stored by the extension

The extension stores only user preferences in Chrome extension storage, including:

- export offsets / maximum chat count
- Markdown user and assistant labels
- Markdown or MDX file extension preference
- MDX frontmatter template
- auto-advance preference
- detected color scheme

The extension does **not** store exported conversation content in Chrome extension storage.

## Authentication/session data

The extension may temporarily read the active ChatGPT session access token from ChatGPT's own session endpoint to request the user's conversations from ChatGPT on the user's behalf after the user initiates an export.

The extension does **not** persist ChatGPT access tokens in `chrome.storage.sync`, `chrome.storage.local`, or other durable extension storage. Token material is kept only in service-worker memory while needed.

## Data use

Data is used only to provide the extension's core functionality:

- exporting the current chat
- exporting all chats
- exporting project chats
- generating Markdown, MDX, JSON, raw JSON, or ZIP exports
- applying user-selected formatting options
- saving export preferences
- showing export progress and cancellation status

## Data sharing / sale

Dashboard declaration should match:

- The extension does **not** sell user data.
- The extension does **not** share, transfer, or transmit ChatGPT conversation data to the developer or third-party analytics services.
- The extension does **not** transfer user data to third parties for advertising or unrelated purposes.
- The extension does **not** use user data to determine creditworthiness or for lending purposes.

## Remote code / analytics

Dashboard declaration should match:

- The extension does **not** use remote executable code.
- All executable code is packaged with the extension.
- The extension does **not** include analytics tracking.

## Export behavior

Exported files are created locally through Chrome's downloads API. Once downloaded, the user's handling of those files is outside the extension's control.

## Permissions alignment

Declared permissions and justifications:

- `activeTab` — identify the currently active ChatGPT tab and determine whether the user is viewing a normal conversation or project conversation.
- `downloads` — save exported JSON, raw JSON, Markdown, MDX, and ZIP files to the user's device.
- `storage` — save user preferences and export settings.
- `https://chatgpt.com/*` — access ChatGPT pages and ChatGPT API responses needed to export the user's own conversations after the user initiates a backup.

## Important dashboard consistency checks

Before submission, confirm the dashboard says:

- User data is used only for the extension's single purpose.
- Data is not sold.
- Data is not used or transferred for unrelated purposes.
- Data is not used for creditworthiness or lending.
- No remote code is used.
- No analytics tracking is included.
- Privacy policy URL points to the current `PRIVACY.md` content or equivalent hosted page.
