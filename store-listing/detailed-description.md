# ChatGPT Backup

ChatGPT Backup helps you export your own ChatGPT conversations to local files.

## Features

- Export the current ChatGPT conversation.
- Export all conversations with optional skip and max-count settings.
- Export ChatGPT project conversations when opened from a project chat.
- Choose between JSON, raw JSON, and Markdown/MDX output.
- Download Markdown exports as individual files or ZIP archives.
- Stop a long-running backup and download the partial result.
- Store only export preferences such as labels, offsets, and Markdown settings.

## Privacy-first behavior

Exports are user-initiated and downloaded locally using Chrome's downloads API. The extension does not sell, share, or transmit your ChatGPT conversation data to the developer or third-party analytics services.

The extension may temporarily read your active ChatGPT session token from ChatGPT's own session endpoint to request your conversations from ChatGPT on your behalf. Token material is kept only in service-worker memory while needed and is not stored in Chrome extension storage.

## Supported formats

- JSON: normalized conversation data.
- Raw JSON: original ChatGPT conversation response data.
- Markdown: readable text export suitable for notes, archives, or documentation.
- MDX: Markdown export with optional frontmatter.

## Notes

This extension is designed for backing up conversations from `https://chatgpt.com/`. You must be logged in to ChatGPT for exports to work.
