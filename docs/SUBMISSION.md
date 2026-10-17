# Community submission notes

- Name: Reading Progress Sync Bridge
- ID: `reading-progress-sync-bridge`
- Repository: https://github.com/DLf2001/reading-progress-sync-bridge
- Version: 0.1.1
- Author: DLf2001
- License: MIT
- Desktop only; Obsidian 1.14.4 or later; Markdown only.
- Required plugins: Remember cursor position 1.0.16 and Remotely Save 0.5.25.

## Review disclosures

Independent companion integration, not a fork and not affiliated with the dependency authors or Obsidian. Dependency source files are not bundled or modified. Runtime wrappers use non-public interfaces (`syncRun`, `updateLastSyncMsg`, and the cursor-position database and writer). Wrappers are restored when disabled. Interface changes may require compatibility updates.

The bridge does not make network requests, access service credentials, collect telemetry, or access files outside the vault. Reading metadata (note paths, positions, device names, and timestamps) are synchronized by the user's existing Remotely Save service. It does not upload note contents on its own. The README describes privacy, clock handling, and backups.

The source ships directly as CommonJS with no build step or runtime npm dependencies. Development dependencies are for tests and lint only. ESLint exceptions are documented in eslint.config.mjs.

## Community listing

Public listing: https://community.obsidian.md/plugins/reading-progress-sync-bridge

Install through the listing's Add to Obsidian button or search for Reading Progress Sync Bridge in Obsidian's Community plugins browser. Install and enable both dependencies on each computer as described in the README.
