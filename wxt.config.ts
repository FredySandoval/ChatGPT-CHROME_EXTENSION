import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'ChatGPT Backup',
    description: 'Backup your OpenAI ChatGPT history in either JSON or Markdown format',
    action: {
      default_title: 'ChatGPT Backup',
    },
    host_permissions: ['https://chatgpt.com/*'],
    permissions: ['activeTab', 'downloads', 'storage'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self';",
    },
  },
});
