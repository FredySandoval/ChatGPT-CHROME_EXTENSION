# Feature report: Markdown export selector

## 1. Goal and agreed scope

Add a dedicated extension page where a user can inspect a saved ChatGPT conversation as **raw Markdown**, select or deselect individual messages, and then copy or download the selected content.

This is an export selector, **not a Markdown editor**. Its selection experience should resemble the existing PDF export page, without PDF layout controls or rendered Markdown.

Required capabilities:

- Load the current saved conversation.
- Display read-only raw Markdown in message-sized blocks.
- Include/exclude each message independently.
- Select all / deselect all.
- Copy selected content to the clipboard.
- Download selected content using the existing Markdown/MDX export and ZIP behavior.
- Optionally include available images and attachments using the existing asset pipeline.

Explicitly out of scope:

- Editing message text, rich-text editing, source editing, split-view editing, or autosaved drafts.
- Rendering Markdown into HTML or showing image thumbnails.
- Reordering messages or editing the original ChatGPT conversation.
- PDF controls: font-size settings, margins, pagination, and printing.
- Selecting messages across multiple chats or projects.
- Transporting image/attachment files through the clipboard.
- New clipboard warnings, confirmation dialogs, or alternative image encodings. Copy remains a convenient text-only operation; relative asset references can be copied as-is.

This document is an implementation plan. Proposed names and contracts below do not exist yet unless explicitly described as existing.

## 2. Project orientation

The extension uses WXT, React, and TypeScript. Entrypoint directories under `entrypoints/` become extension pages. ZIP generation already uses `@zip.js/zip.js`; no new editor, Markdown renderer, or ZIP dependency is needed.

### Existing code to read first

| File | Relevant behavior |
| --- | --- |
| `entrypoints/popup/App.tsx` | Source/format selection; `performDownload()` opens the PDF page for Current Chat + PDF; `backupCurrentChat()` performs direct exports; `handleCopy`-related logic writes returned text with `navigator.clipboard.writeText()`. Search for `output: 'clipboard'`. |
| `entrypoints/pdf/index.html`, `main.ts` | Existing WXT page bootstrap to follow for a new page. |
| `entrypoints/pdf/preview.tsx` | Loading, error/busy states, per-message selection, bulk selection, excluded-message visibility, title and label controls. Reuse the interaction patterns, not its entire PDF implementation. |
| `entrypoints/pdf/style.css` | Existing export workspace styling. Some styles are print-specific and should not be imported indiscriminately. |
| `lib/export-document.ts` | PDF-facing `ExportConversation`, `selectMessages()`, and label helpers. Its data model is deliberately simplified and is not sufficient for downloadable assets. |
| `entrypoints/background.ts` | Conversation fetching/parsing, runtime request types, Markdown serialization, clipboard text responses, asset downloads, and ZIP creation. Most required backend functionality is here. |
| `lib/pdf-branch.ts` | `activeBranch()` selects the currently active conversation branch. Despite its filename, it is useful to a current-conversation selector too. |
| `lib/pdf-research.ts` | `withResearchReports()` handles research content in the PDF preparation path. Evaluate/reuse for selector loading. |
| `lib/page-export-success.ts` | Existing export-page success feedback integration; review before adding new success UI. |
| `tests/pdf-export.test.mjs` | Lightweight assertions for branch selection and export helpers. |
| `tests/pdf-preview.browser.mjs` | Existing browser-test approach for the PDF export page. |
| `tests/messaging-bugs.test.mjs` | Messaging regression tests to review when modifying background dispatch. |
| `wxt.config.ts` | Existing manifest permissions and build configuration. |

### Existing Markdown behavior to preserve

In `entrypoints/background.ts`:

- `jsonToMarkdown()` serializes user/assistant messages, custom role labels, normalized content, optional asset references, and message separators.
- It prefers `rendered_markdown` when present, otherwise uses `applyContentReferences()` on message content. Do not replace this with a naive `content.join()` in the new preview.
- `applyMdxFrontmatter()` applies configured frontmatter when the extension is `.mdx`.
- `downloadMarkdownZip()` handles both plain-file and ZIP downloads and has a `textOnly` path used for clipboard output.
- A single chat without asset bundling downloads as `.md` or `.mdx`.
- With asset inclusion enabled and assets present, a single chat downloads as a ZIP containing the document and supporting files.
- `addChatImagesToZip()` writes images under `images/`.
- `addChatAttachmentsToZip()` writes files under `attachments/`.
- `jsonToMarkdown()` writes corresponding relative Markdown links.
- The existing `includeImages` flag also controls attachment references and bundling. UI wording should therefore be **Include images and attachments**, even if the internal flag retains its existing name.
- Existing multi-chat/project export behavior must not change as a side effect of this feature.

## 3. Proposed user experience

### Entry into the page

Recommended initial integration: keep existing quick Copy and Download actions unchanged and add **Select messages** (or **Customize Markdown export**) for Current Chat + Markdown.

The new action opens `/markdown.html?tab=<source-tab-id>`, analogous to `/pdf.html?tab=...`. This preserves existing fast workflows and makes the new capability discoverable without forcing a preview step on every export.

If product instead wants the primary Markdown Download action to open the selector, that is a separate routing decision. Do not silently change existing copy, project, or bulk-export behavior while implementing the page.

### Layout

Header:

- Title: **Export Markdown**.
- Actions: **Copy** and **Download**.
- Small selection summary, for example `8 of 12 messages selected`.

Document area:

- One block per selectable message in conversation order.
- A checkbox and role/message identifier outside the export text.
- Raw Markdown in a read-only `<pre>` or equivalent text container.
- Wrapping via `white-space: pre-wrap` and suitable long-token wrapping; preserve whitespace and indentation in the actual source string.
- Render strings through React text nodes. Never use `dangerouslySetInnerHTML`.
- No syntax highlighting dependency is necessary for the MVP.

Controls:

- Select all / deselect all. Consider an indeterminate checkbox when partially selected.
- Show excluded messages, enabled initially. Excluded messages are dimmed but remain easy to reselect.
- Include images and attachments, available when supported assets exist. Default on to match current-chat exports, which currently request `includeImages: true`.
- Optional title/role-label visibility controls can follow the PDF interaction, but are secondary to message selection. See the serialization caveat below.

Behavior:

- Initially include every selectable message.
- Hiding excluded messages must not destroy their selection identity.
- Do not automatically deselect related prompts or answers; selections are independent.
- Copy/Download are disabled during loading, on load failure, while busy, and when the selection is empty.
- Maintain accessible checkbox labels and keyboard operation. Use status/alert regions for completion and errors.
- Report clipboard/download failures without resetting selection.
- Closing the page discards its selection; persistence is not needed.

### Clipboard decision

Copy writes the selected Markdown string only. When asset inclusion is enabled, relative image/attachment references remain in that string. No files are copied, no base64 embedding is added, and no blocking warning is required. This is an intentional product decision for quick inspections and small chats.

## 4. Critical architectural constraint: preserve asset identity

Do **not** implement this by taking the current PDF `ExportConversation` object and handing it to the Markdown downloader.

The PDF model contains image names/data URLs and attachment names. It omits file IDs, asset pointers, attachment metadata, conversation ID, and conversation-level asset inventories needed by the existing asset-download pipeline.

Also, the current `preparePdf` handler eagerly downloads image bytes for display. The Markdown selector needs only source text and asset metadata on load. Fetch actual files only when downloading a selected asset-inclusive export.

Recommended structure:

1. Retain a normalized parsed conversation as the page's immutable in-memory snapshot.
2. Associate each message with its original snapshot index (or an explicit stable snapshot-local ID).
3. Render and select against that snapshot.
4. Build a selected parsed conversation through a pure helper.
5. Feed that selected object into the existing Markdown serializer/download pipeline.

Do not refetch the source chat on every checkbox change or silently fetch a different conversation during export. A source tab can navigate while the selector is open; the export should represent the loaded snapshot.

## 5. Suggested implementation design

### A. Shared types and pure export helpers

Add a focused module such as `lib/markdown-export.ts` for shared Markdown export types and pure helpers. Move only the necessary types/serialization code out of `background.ts`; avoid a broad background rewrite.

Candidates for shared types:

- `ImageAssetReference`.
- `AttachmentReference`.
- `UnsupportedAssetReference`.
- `NormalizedMessage` and `ParsedConversation`, or a deliberately scoped equivalent that retains all fields needed by existing serialization/enrichment/download helpers.
- Markdown settings/options and typed request/response payloads.

Candidates for pure helpers:

- Selecting messages and rebuilding asset inventories.
- Serializing one message and the full document from the same primitives.
- Applying MDX frontmatter, if it can be extracted cleanly.

Keep network requests, authenticated file retrieval, Chrome download APIs, and ZIP orchestration in the background. Do not import the background entrypoint into the page to reuse functions.

### B. Prepare request

Add a request such as:

```ts
type PrepareMarkdownRequest = {
  message: 'prepareMarkdown';
  tabId: number;
};
```

Respond with a serializable parsed conversation snapshot and useful availability metadata, or a typed error. No image blobs, data URLs, or credentials are needed in this response.

Follow the security pattern in `preparePdf`:

- Accept only the extension's `/markdown.html` sender, checking both extension origin and exact pathname.
- Validate `tabId` as a positive integer.
- Validate the source tab origin as `https://chatgpt.com` and require a saved conversation URL.
- Use the existing conversation-fetching path (`handleSingleRawUrlId()`), not page scraping.
- Resolve the current active branch and research content intentionally. The PDF preparation path currently calls `activeBranch()`, then `withResearchReports()`, then `parseConversation(..., true)` to preserve branch order.
- Return a meaningful error for invalid branch data, missing conversation, expired authentication, closed tab, or fetch failure.
- Preserve the asynchronous message channel with the existing `return true` pattern.

Current direct Markdown export and PDF preparation do not necessarily choose their messages identically. The selector should deliberately show the active conversation branch, matching the PDF selection experience; add tests rather than assuming parser defaults do this.

### C. Page implementation

Add:

- `entrypoints/markdown/index.html`.
- `entrypoints/markdown/main.ts`.
- `entrypoints/markdown/preview.tsx` (or `selector.tsx`).
- `entrypoints/markdown/style.css`.

Follow the PDF bootstrap convention so WXT produces `markdown.html`.

State should include:

- Immutable loaded snapshot.
- Selected original indices/IDs.
- Markdown settings loaded from `chrome.storage.sync`.
- Asset-inclusion option.
- Excluded-message visibility.
- Loading, busy, error, and completion state.

Use the same serialization primitives for the raw message bodies and final output. Role captions/checkmarks/selection summaries are UI only and must never leak into copied/downloaded text.

Read existing settings for `userLabel`, `assistantLabel`, `markdownExtension`, and `mdxFrontmatter`. Respect intentionally empty role labels; avoid `value || default` where an empty string means “omit label.”

Optional visibility toggles must be implemented in serialization, not merely CSS. Existing `jsonToMarkdown()` does not prepend a standalone conversation title, so a PDF-style “Show title” switch is not a free reuse. Preserve existing output by default; defer this switch unless explicitly implemented and tested. MDX frontmatter title is a separate existing setting.

### D. Selection and asset inventories

This is the highest-risk correctness detail.

`ParsedConversation` includes both per-message asset lists and conversation-level asset lists. The ZIP writer reads conversation-level lists. Filtering only `messages` would therefore still bundle files from excluded messages.

The selection helper must:

1. Filter messages using their original snapshot identity, preserving original order.
2. Preserve conversation metadata needed for export, especially `conversation_id` and title.
3. Rebuild `images`, `attachments`, and `unsupported_assets` from selected messages only.
4. Deduplicate downloadable assets by stable identity, such as file ID.
5. Keep a shared asset when at least one selected message references it.
6. Avoid mutating the source snapshot.

Review how `parseConversation()` associates message-level references before coding this helper. Unsupported-asset inventories must not retain diagnostics from excluded messages either.

### E. Copy path

Serialize the selected snapshot with the current options and existing Markdown/MDX rules, then call `navigator.clipboard.writeText()` from the visible export page in response to the user's click.

Prefer having the final text already computed in page state/memoization so a copy click does not require a network round trip before clipboard access. This also makes clipboard behavior easier to reason about under browser user-activation restrictions.

Report success only after the clipboard promise resolves. On failure, leave the selected content available and allow retry. Do not add clipboard-read permissions. Verify actual browser behavior before introducing any additional write permission; the existing manifest has no clipboard permission and the popup already writes text.

### F. Download path

Add a distinct typed runtime request for selected Markdown download rather than overloading bulk export or invoking the original unfiltered `backUpSingleChat` request.

A straightforward stateless design sends the selected snapshot and options from the page to the background, which validates them and calls the existing `downloadMarkdownZip()` pipeline. No background cache is required, so service-worker suspension does not invalidate the page's selection.

Validate the sender as strictly as the prepare request. Validate payload shape, allowed extension, message/asset fields, and conversation/file identifiers before processing; treat runtime payloads as input, not automatically trusted TypeScript values. Never accept arbitrary URLs for authenticated asset fetching.

If the implementation instead stores a server-side/background snapshot and sends selection IDs, document how snapshot ownership, service-worker restart, page refresh, and expiry work. Avoid introducing that lifecycle complexity without a reason.

Expected output:

- No selected supported assets, or asset inclusion off: `.md`/`.mdx` file under existing filename rules.
- Asset inclusion on with selected assets: existing ZIP layout, Markdown references, and asset download behavior.
- No selected messages: reject defensively in the background too.

Review the existing unsupported-asset behavior: `downloadMarkdownZip()` can choose a ZIP based on `unsupported_assets` even if no downloadable image/attachment is present. Preserve/document this compatibility behavior or make an explicit separately tested change; do not promise that every ZIP contains usable assets.

Review existing failure handling in `addChatImagesToZip()` and `addChatAttachmentsToZip()`. Reuse it rather than claiming a successful response guarantees every remote file was retrievable. Surface warnings if already available from the pipeline; avoid a new asset-recovery system in this feature.

## 6. File-by-file change checklist

| Location | Proposed change |
| --- | --- |
| `entrypoints/popup/App.tsx` | Add current-chat Markdown selector entry action; open the new tab with source tab ID; preserve existing direct actions and all other formats/sources. |
| `entrypoints/markdown/*` | Add page bootstrap, read-only raw text UI, selection state, asset toggle, copy/download actions, and status handling. |
| `lib/markdown-export.ts` (new, suggested) | Share asset-aware types, immutable selection/inventory rebuilding, and serialization primitives as needed. |
| `entrypoints/background.ts` | Add typed prepare/download requests to `BackgroundRequest`, strict sender/payload checks, metadata-only preparation, and routing to existing downloader. Import extracted helpers without changing legacy behavior. |
| `lib/export-document.ts` | Prefer leaving the PDF model unchanged. Generalize a selection utility only if it genuinely benefits both pages without losing Markdown asset metadata. |
| `entrypoints/pdf/*` | No required behavior changes. Extract small shared UI/styles only where worthwhile; avoid introducing Markdown options into PDF state. |
| `tests/markdown-export.test.mjs` (new, suggested) | Pure selection/serialization/asset-inventory tests. |
| Browser/messaging tests | Add page interaction and runtime validation coverage, following existing test conventions. |
| `README.md` | Briefly document the new current-chat selection workflow once implemented. |

Do not import `entrypoints/pdf/markdown.tsx` for this page: it renders Markdown, which this feature explicitly avoids.

## 7. Test plan

### Pure helper tests

- All, some, and no messages selected.
- Preserve original conversation order even if selection IDs arrive out of order.
- Duplicate selection IDs do not duplicate output; invalid selection IDs are rejected or ignored by an explicitly tested rule.
- Source snapshot is unchanged after selection.
- Excluded-only assets disappear from all top-level inventories and final references.
- Shared asset survives if one referencing message remains selected and appears only once in the inventory.
- Attachment handling matches image handling.
- Unsupported diagnostics reflect selected messages only.
- `rendered_markdown`, content references, code fences, tables, Unicode, and whitespace survive serialization.
- Empty/custom role labels retain existing semantics.
- `.mdx` frontmatter is applied once with the existing title/settings behavior.
- With all messages selected and unchanged options, extracted serialization produces the same output as the existing pipeline for the same normalized conversation.

### Page/browser tests

- Loading succeeds from a saved conversation and initially selects all messages.
- Visible Markdown is literal text: headings/fences/HTML-like input are not rendered as HTML.
- Deselect/reselect, select all, and hide excluded work with stable message identities.
- Selection count updates; empty selection disables Copy and Download.
- Asset toggle updates raw references and eventual output, without fetching image bytes during page load.
- Copy writes exactly the selected serialized document, including relative asset references when enabled; it does not request or copy files and does not display a blocking asset warning.
- Download without assets returns a plain file; asset-enabled download contains the selected document and selected files only.
- Clipboard rejection/download failure shows an error without losing selection.
- Navigating or closing the source tab after successful load does not change the loaded snapshot.
- Multiple selector tabs operate independently.
- Research/branch fixtures confirm that the selector reflects the active branch in the right order.

### Runtime/security/regression tests

- Reject requests from content scripts, ordinary web pages, and other extension pages not explicitly allowed.
- Reject invalid source tab IDs, invalid source URLs, malformed export payloads, and empty exports.
- Test service-worker restart between preparation and download for the stateless design.
- Keep PDF export, direct Markdown copy/download, JSON/raw JSON, project export, and all-chat export working.
- Confirm no conversation content is written to persistent storage or debug logs by the new flow.

### Validation commands

The package defines `compile` and `build`, but no aggregate `test` script:

```sh
pnpm compile
pnpm build
```

Run the existing `.mjs` tests using the repository's established Node/browser setup. Some tests import TypeScript directly, so use a compatible Node version or the project's established loader. Read the browser test's prerequisites before invoking it. Add new tests in the same style rather than assuming `pnpm test` exists.

## 8. Suggested delivery sequence

1. Extract and test shared types/serialization with output-parity assertions.
2. Implement and test immutable message selection plus asset-inventory rebuilding.
3. Add the metadata-only prepare handler with sender/source validation.
4. Build the raw Markdown page and checkbox interactions.
5. Wire Copy through the shared serializer.
6. Add validated download messaging and reuse the existing ZIP pipeline.
7. Add the popup entry action.
8. Run browser, security, and legacy-export regression checks; update user-facing documentation.

## 9. Definition of done

A user can open a current saved chat in a dedicated Markdown export page, inspect raw source, deselect unwanted messages, and copy or download only the remaining content. Optional images and attachments reuse the existing ZIP mechanism, and assets belonging only to excluded messages are not bundled. Clipboard output remains plain text with optional relative references, without new warnings or file-transfer behavior. No editor or rendered-Markdown UI is introduced, and existing export workflows continue to work.
