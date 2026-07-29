import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    default_locale: 'en',
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    action: {
      default_title: '__MSG_extensionName__',
    },
    host_permissions: ['https://chatgpt.com/*'],
    permissions: ['activeTab', 'downloads', 'storage'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self';",
    },
  },
});
