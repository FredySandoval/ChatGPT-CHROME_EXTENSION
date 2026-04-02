const DEFAULT_USER_LABEL = '<img src="https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png" width="24" alt="User" />';
const DEFAULT_ASSISTANT_LABEL = '<img src="https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg" width="24" alt="Assistant" />';
const DEFAULT_SKIP_NEWEST_CHATS = 0;
const DEFAULT_MAX_CHATS_TO_EXPORT = 40;
const DEFAULT_MARKDOWN_EXTENSION = '.md';
const DEFAULT_MDX_FRONTMATTER = '---\ntitle: "{{title}}"\n---';

function deriveMaxChatsToExport(startOffset, stopOffset) {
  const start = Number(startOffset ?? DEFAULT_SKIP_NEWEST_CHATS);
  const stop = Number(stopOffset ?? (start + DEFAULT_MAX_CHATS_TO_EXPORT));

  if (stop === -1) return '';
  return Math.max(stop - start, 0);
}

function updateMdxFrontmatterState() {
  const markdownExtension = document.querySelector('input[name="markdownExtension"]:checked')?.value || DEFAULT_MARKDOWN_EXTENSION;
  const frontmatter = document.querySelector('#mdxFrontmatter');
  frontmatter.disabled = markdownExtension !== '.mdx';
}

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get([
    'startOffset',
    'stopOffset',
    'userLabel',
    'assistantLabel',
    'markdownExtension',
    'mdxFrontmatter',
  ], (result) => {
    const startOffset = Number(result.startOffset ?? DEFAULT_SKIP_NEWEST_CHATS);
    const stopOffset = result.stopOffset ?? (DEFAULT_SKIP_NEWEST_CHATS + DEFAULT_MAX_CHATS_TO_EXPORT);
    const userLabel = result.userLabel || DEFAULT_USER_LABEL;
    const assistantLabel = result.assistantLabel || DEFAULT_ASSISTANT_LABEL;
    const markdownExtension = result.markdownExtension || DEFAULT_MARKDOWN_EXTENSION;
    const mdxFrontmatter = result.mdxFrontmatter || DEFAULT_MDX_FRONTMATTER;

    document.querySelector('#startOffset').value = startOffset;
    document.querySelector('#maxChatsToExport').value = deriveMaxChatsToExport(startOffset, stopOffset);
    document.querySelector('#user').value = userLabel;
    document.querySelector('#assistant').value = assistantLabel;
    document.querySelector(`input[name="markdownExtension"][value="${markdownExtension}"]`).checked = true;
    document.querySelector('#mdxFrontmatter').value = mdxFrontmatter;
    updateMdxFrontmatterState();
  });

  document.querySelectorAll('input[name="markdownExtension"]').forEach((input) => {
    input.addEventListener('change', updateMdxFrontmatterState);
  });
});

document.querySelector('form').addEventListener('submit', (event) => {
  event.preventDefault();

  const startOffset = Number(document.querySelector('#startOffset').value || DEFAULT_SKIP_NEWEST_CHATS);
  chrome.storage.sync.set({ startOffset }, () => {
    console.log('startOffset saved:', startOffset);
  });

  const maxChatsRaw = document.querySelector('#maxChatsToExport').value.trim();
  const maxChatsToExport = maxChatsRaw === '' ? -1 : Math.max(Number(maxChatsRaw), 0);
  const stopOffset = maxChatsToExport === -1 ? -1 : startOffset + maxChatsToExport;
  chrome.storage.sync.set({ stopOffset }, () => {
    console.log('stopOffset saved:', stopOffset);
  });

  const userLabel = document.querySelector('#user').value || DEFAULT_USER_LABEL;
  chrome.storage.sync.set({ userLabel }, () => {
    console.log('userLabel saved:', userLabel);
  });

  const assistantLabel = document.querySelector('#assistant').value || DEFAULT_ASSISTANT_LABEL;
  chrome.storage.sync.set({ assistantLabel }, () => {
    console.log('assistantLabel saved:', assistantLabel);
  });

  const markdownExtension = document.querySelector('input[name="markdownExtension"]:checked')?.value || DEFAULT_MARKDOWN_EXTENSION;
  chrome.storage.sync.set({ markdownExtension }, () => {
    console.log('markdownExtension saved:', markdownExtension);
  });

  const mdxFrontmatter = document.querySelector('#mdxFrontmatter').value || DEFAULT_MDX_FRONTMATTER;
  chrome.storage.sync.set({ mdxFrontmatter }, () => {
    console.log('mdxFrontmatter saved:', mdxFrontmatter);
  });
});
