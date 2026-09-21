> [!TIP]
> **Open to contributions.** If you'd like to improve the extension, fix a bug, or add a feature, feel free to open a Pull Request. Even small improvements are welcome. If you find the project useful, consider giving it a ⭐ to help others discover it, or sponsor it.
> </br>
> <a href="https://github.com/sponsors/FredySandoval">
> <img src="https://img.shields.io/badge/Sponsor-ChatGPT%20Backup-ea4aaa?style=for-the-badge&logo=githubsponsors" alt="Sponsor on GitHub Sponsors">
> </a>
# ChatGPT Backup Tool for Chrome

<p align="center">
  <img width="1400" height="560" alt="Marquee promo 1400x560 Canvas" src="https://github.com/user-attachments/assets/6240bf0d-39af-4a2b-a349-9f38e76df969" />
</p>



### [chromewebstore.google.com/chatgpt-backup](https://chrome.google.com/webstore/detail/chatgpt-backup/majboohgjfdnegkhadaialohhlimolcc)




**ChatGPT Backup Tool** is a Chrome extension built for users who want a fast, simple, and flexible way to export their ChatGPT data. Whether you need a personal archive, project documentation, research notes, or machine-readable backups, this extension gives you one-click exports in formats that are actually useful.


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

### Export the current chat as PDF
Choose **Current Chat → PDF → Preview conversation**. A separate tab opens an HTML document preview. Include or exclude messages, restore
them with **Include all**, or hide excluded messages to review your selection.
Click **Download PDF** when ready; there is no automatic download. The PDF is
generated locally without opening the print dialog. Selections affect only the
export, never your original ChatGPT conversation.

The HTML preview uses your saved labels and updates when those settings change.
PDF formatting can differ from the HTML preview while the export engine is being
evaluated. The preview and PDF generator share content and selection data but
are separate renderers.

The initial PDF export includes headings, lists, tables, links, monospaced code,
your configured User/Assistant labels, and available ChatGPT image assets. Images are embedded in the PDF;
unavailable or oversized images are reported in the export tab instead of adding notes to the PDF.
Equations remain source text. Linked web images keep their original alt text or URL as links, and non-image
attachments are listed by name rather than embedded. Bulk PDF export and broad
CJK/emoji font coverage are not included in this first version.

Keep the export tab open until the download starts. PDF export uses the conversation's
saved active branch. Image limits are 15 MB per image and 24 MB total before conversion;
embedded images are resized to at most 1800 pixels on their longest side.

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



```txt
# Own your conversations
# Your prompts, ideas, research, and work sessions are valuable.
```

### PDF development checks

Run `node tests/pdf-export.test.mjs` with Node 22.18+ to check branch selection,
Markdown conversion, and real PDF generation. Pass an output path to save the
sample PDF for visual review. Run `pnpm compile` and `pnpm build` before release.

Run `node tests/pdf-preview.browser.mjs` after building to exercise the HTML
preview, selection/restoration, settings updates, and PDF download in an isolated
Chromium profile with synthetic data. Requires Chromium and Poppler; set
`CHROMIUM_PATH` if Chromium is installed elsewhere.
