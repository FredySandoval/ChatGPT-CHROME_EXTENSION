# ChatGPT Backup Tool for Chrome

[<img width="640" height="400" alt="ChatGPT Backup Tool" src="https://github.com/user-attachments/assets/c02ea7c3-47f5-475f-b2fa-90228ac490ed">](https://youtu.be/UA2cKUqcGlM?si=fSPQScwtwsj8k4_M)

[Chrome Web Store: ChatGPT Backup Tool](https://chrome.google.com/webstore/detail/chatgpt-backup/majboohgjfdnegkhadaialohhlimolcc)

Back up your ChatGPT conversations in seconds.

**ChatGPT Backup Tool** is a Chrome extension built for users who want a fast, simple, and flexible way to export their ChatGPT data. Whether you need a personal archive, project documentation, research notes, or machine-readable backups, this extension gives you one-click exports in formats that are actually useful.

## Why install it?

If your ChatGPT conversations matter, you should own a copy of them.

This extension helps you:
- Back up a **single conversation** or **your full chat history**
- Export in **Markdown / MDX-ready Markdown** for readable notes and documentation
- Export in **JSON** for automation, scripting, and data processing
- Save **all markdown chats as a ZIP** for easy archiving
- Export **raw JSON** when you need the original structured data
- Preserve **rich content rendering** more accurately in exports
- Include **file citation rendering support** in exported content
- Back up the **current ChatGPT project** when working inside project-based chats
- Track download/export progress directly from the popup
- Stop long-running downloads when needed
- Customize labels and markdown/frontmatter behavior from the options page

## Main features

### Export the current chat
Quickly download the conversation you are currently viewing in:
- **JSON**
- **Markdown**

Perfect for saving important prompts, answers, study sessions, code reviews, brainstorming sessions, and documentation.

### Export all chats
Need everything? Export your full history with just a few clicks:
- **All chats as one JSON file**
- **All chats as Markdown files inside a ZIP archive**

Ideal for complete backups, audits, migration, or personal archives.

### Export the current project
If you use ChatGPT Projects, the extension can also help you export project-related conversations.

This includes:
- **Current project backup flow**
- **Project-aware actions in the popup**
- **Project conversation discovery** for project-specific exports

### Raw JSON export
For power users, developers, and automation workflows, raw JSON export gives you access to structured conversation data for:
- custom scripts
- data pipelines
- analytics
- migration workflows
- research tooling

### Better Markdown, MDX, and frontmatter output
Markdown export is designed to be practical, readable, and ready for modern content workflows.

Recent improvements include:
- better default markdown labels
- improved sizing and layout behavior
- richer content rendering
- frontmatter-related improvements
- customizable USER / ASSISTANT label sections
- support for plain text, markdown, or HTML label content
- cleaner output for users who want to move conversations into **MDX-based docs, blogs, notes, or knowledge bases**

If you publish content with tools like Astro, Next.js, Docusaurus, Contentlayer, or any markdown-based documentation site, frontmatter support makes exported chats easier to organize and reuse.

That means you can take a ChatGPT conversation and turn it into something closer to publishable content, with metadata and structure that fit modern markdown workflows.

### File citation rendering support
Conversations that reference uploaded files or file-based content are handled better with improved citation rendering support in exports.

### Progress updates and control
The popup keeps you informed while exports are running.

You get:
- progress/log feedback in the extension UI
- clearer popup actions and layout
- support for stopping downloads when necessary

### Easy configuration
The options page lets you tailor exports to your workflow.

Depending on your preferred setup, you can configure items such as:
- start/end offsets
- markdown labels
- frontmatter-related settings
- USER / ASSISTANT section formatting
- HTML/markdown/plain-text display preferences
- formatting choices that make exports easier to reuse in markdown/MDX publishing workflows

## Built for real use

This extension is useful for:
- **students** saving study sessions
- **developers** archiving debugging conversations
- **researchers** collecting prompt/output datasets
- **writers** preserving drafts and ideation threads
- **teams** keeping project conversations documented
- **power users** creating structured data exports for automation

## Open source

ChatGPT Backup Tool is open source, so you can inspect the code, suggest improvements, and adapt it to your workflow:

[https://github.com/FredySandoval/ChatGPT-CHROME_EXTENSION](https://github.com/FredySandoval/ChatGPT-CHROME_EXTENSION)

## Project structure

```txt
CHROME_EXTENSION/
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── options/
│   ├── options.html      # Export settings and markdown configuration
│   └── options.js
├── popup/
│   ├── FileSaver.js      # File saving helper
│   ├── jsZip.js          # Compressed ZIP generation for markdown exports
│   ├── popup.html        # Extension popup UI
│   └── popup.js
├── scripts/
│   └── content-script.js # Page/project discovery support
├── manifest.json         # Chrome extension manifest (MV3)
└── service-worker.js     # Main backup/export logic
```

## Install

1. Open the [Chrome Web Store listing](https://chrome.google.com/webstore/detail/chatgpt-backup/majboohgjfdnegkhadaialohhlimolcc)
2. Install **ChatGPT Backup Tool**
3. Open ChatGPT
4. Click the extension icon
5. Choose what you want to export: current chat, all chats, or project data

## Own your conversations

Your prompts, ideas, research, and work sessions are valuable.

**ChatGPT Backup Tool** makes it easy to keep them safe, portable, readable, and reusable.

Install it, export what matters, and keep your ChatGPT history under your control.
