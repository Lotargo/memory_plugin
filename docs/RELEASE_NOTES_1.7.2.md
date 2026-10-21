# 1.7.2 — Dashboard languages

The local dashboard now supports **English**, **Russian** and **Simplified Chinese (简体中文)**. English is the default regardless of browser language.

- Choose **Language** in the sidebar, above **Theme**. On mobile, open **Scope** first.
- The choice is remembered across page reloads and dashboard port changes.
- Labels, dialogs, status messages, dates and record/file counts update in place, preserving drafts and selected records.
- Stored Notebook text, source content, project names and identifiers retain their original text.

Update with `npm install -g @lotargo/memory_plugin@1.7.2`, then run `memory-plugin web restart` and refresh the dashboard tab. For a marketplace installation, update the plugin through the client's plugin manager. Existing client sessions may need to be restarted to load the updated plugin.

This release keeps the existing storage format, client APIs and dependencies. Validation covers 70 regression suites, real Chrome language switching with isolated memory, the package privacy gate and a fresh tarball installation with a production dependency audit. Native client sessions and live Linux/macOS behavior were not revalidated for this UI update.
