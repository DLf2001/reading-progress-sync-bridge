# Community submission notes

- Name: Reading Progress Sync Bridge
- ID: `reading-progress-sync-bridge`
- Repository: https://github.com/DLf2001/reading-progress-sync-bridge
- Version: 0.1.0
- Author: DLf2001
- License: MIT
- Desktop only; Obsidian 1.14.4 or later; Markdown only.
- Required plugins: Remember cursor position 1.0.16 and Remotely Save 0.5.25.

## Review disclosures

Independent companion integration, not a fork and not affiliated with the dependency authors or Obsidian. Dependency source files are not bundled or modified. Runtime wrappers use non-public interfaces (`syncRun`, `updateLastSyncMsg`, and the cursor-position database and writer). Wrappers are restored when disabled. Interface changes may require compatibility updates.

The bridge does not make network requests, access service credentials, collect telemetry, or access files outside the vault. Reading metadata (note paths, positions, device names, and timestamps) are synchronized by the user's existing Remotely Save service. It does not upload note contents on its own. The README discloses privacy, clock, backup, and verification limitations.

The source ships directly as CommonJS with no build step or runtime npm dependencies. Development dependencies are for tests and lint only. ESLint exceptions are documented in eslint.config.mjs; passing lint does not guarantee community acceptance.

## Verification status

Eighteen automated tests pass, including three isolated simulated devices. A real local export and readback of three records passed in Obsidian 1.14.4. Real cloud handoff between physical computers has not yet been tested. See TESTING.md; do not present this release as fully end-to-end verified.

## Submission

Follow the current official directory workflow at https://community.obsidian.md: sign in, connect the repository owner's GitHub account, and select Plugins → New plugin. Submit the public repository URL above after its matching release assets exist. The account owner must review and accept developer policies and the maintenance commitment. GitHub publication is not itself submission or community approval.
