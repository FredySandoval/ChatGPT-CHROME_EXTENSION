# Permission Justifications

## `activeTab`

Used to identify the currently active ChatGPT tab and determine whether the user is viewing a normal conversation or a project conversation. This is needed for user-initiated current-chat and current-project exports.

## `downloads`

Used to save exported JSON, raw JSON, Markdown, and ZIP files locally through Chrome's downloads API.

## `storage`

Used to save user preferences such as export offsets, max chat count, Markdown labels, Markdown/MDX preference, frontmatter template, auto-advance setting, and detected color scheme.

## Host permission: `https://chatgpt.com/*`

Used to access ChatGPT pages and ChatGPT API responses needed to export the user's own conversations after the user initiates a backup.
