# Matcha Element beta handoff

Updated: 2026-10-23, Asia/Jakarta. Keep this file current and never put credentials or real chat content in Git.

## Current task and authority

The user reviewed the UI, requested a redesign, and then explicitly said to deploy to
`https://beta-element.matchahoneylatte.com`. Deployment is authorised. The earlier UI-review hold is resolved.
The user corrected the GitHub owner to **bouyant-dev**; the canonical fork is
<https://github.com/bouyant-dev/element-web>, branch `matcha-beta`. Local `origin` points there and
`upstream` points to `element-hq/element-web`. Do not publish future changes to the earlier personal fork.

Main <https://element.matchahoneylatte.com> remains official Element Web **1.12.32**.
Leave Synapse's version and configuration alone. The user's update requirement means keeping the **Element fork**
synced with official stable releases, not upgrading Synapse.

## Implemented behavior

- Favourites is the first room filter. Beta defaults `RoomList.showSections` to false; existing account preferences can override defaults.
- Per-chat General and up to four thread tabs. New thread creates a named native thread; Thread history shows all active and archived threads with rename/archive/restore controls. Selected threads reuse Element's native thread timeline, encryption, composer, attachments and receipts in the main area.
- Archive/restore removes threads from beta's selector for everyone and preserves their messages. Other Matrix clients can still show these threads. Normal message permissions govern new archive/rename metadata; old archive state remains readable.
- Per-chat Kanban: To do, In progress, Done; card title and optional description; create/edit, accessible status selector, action menu, confirmed archive and restore.
- All boards collects cards only from currently joined chats, labels each source chat, and opens its source. Cards can link/unlink a thread, and Open thread works from room and universal boards. Leaving a chat immediately removes its cards. Background updates preserve cards and drafts without a refresh icon or loading flash.
- Personal is a permanent beta sidebar entry next to Home, available without selecting a chat. `#/personal` opens the same joined-chat Kanban recap and survives reload. Cards remain shared with their original chats; Personal does not create a Matrix room or private copies. It cannot be removed or reordered with spaces.
- Reminder action sends an encrypted Matrix command to a dedicated bot. The bot persists schedules independently of browsers and posts in the same chat at the due time.
- No destructive thread deletion, automatic bot invitations, or real-room test messages are authorised.

## Design and verification

The first board design was rejected. A dedicated designer revised it and an independent reviewer rated the final
rendered UI **8.2/10** across full Element, narrow, mobile and dark-mode screenshots. The final design uses compact
cards, source-chat chips, status dropdowns and a single compact room toolbar. Do not reintroduce stacked action links.
This score is a visual review, not full assistive-technology certification.

Before deployment, the following checks passed:

- Production-mode preview build `1.12.32-matcha-preview`.
- 75 focused thread/application tests, 94 room-list tests, 11 Kanban model tests and 6 reminder UI tests.
- 12 Chromium board/thread view tests, typechecks, formatting and focused lint.
- 2 integrated browser scenarios with synthetic Matrix accounts/rooms: thread reply/archive/restore, card creation/movement/archive/restore, cross-chat recap and same/different-chat source navigation.
- The encrypted-room browser scenario fetched raw server events and confirmed board roots/card updates were encrypted, without plaintext card titles or descriptions.
- 15 reminder-service tests inside Linux Node 24, covering durable schedules, cancellation, retries, invitation controls, encryption dispatch and sync durability.

A deployment build must use a unique commit-derived VERSION and normal minification. Do not set CI_PACKAGE for the
published build: upstream uses that flag to disable minification for fast CI test bundles.

## Source map and protocols

- `apps/web/src/components/structures/RoomView.tsx`: main-area integration.
- `apps/web/src/components/structures/{MatrixChat,LoggedInView}.tsx` and `apps/web/src/components/views/spaces/{SpacePanel,SpaceTreeLevel}.tsx`: Personal routing, rendering, and permanent sidebar navigation.
- `apps/web/src/viewmodels/room/RoomThreadTabsViewModel.ts`: thread tabs and archive.
- `apps/web/src/viewmodels/room/KanbanBoardViewModel.ts`: boards, permissions, pagination and decrypted revisions.
- `packages/shared-components/src/room/{RoomThreadTabs,KanbanBoard}`: presentation, stories and component tests.
- `apps/web/src/utils/matcha/reminders.ts`: existing-dialog reminder flow and input validation.
- `apps/web/playwright/e2e/threads/matcha-thread-tabs.spec.ts`: integrated synthetic scenarios and preview captures.
- `tools/matcha-reminder-bot`: standalone Node 24 service, its own npm lockfile and Dockerfile.

Thread metadata: encrypted timeline event `com.matchahoneylatte.thread.metadata`, related to the native root with `m.reference`, containing `{version:1,name?:string,archived?:boolean}`. Reads resolve the latest independent field patches in server order. Legacy state `com.matchahoneylatte.thread_archive` is read only as a fallback. No new title/body/archive flag is written to room state and no redaction is performed.

New thread creation sends the named root plus a hidden custom `m.thread` bootstrap event. That establishes native server aggregation before any user reply and survives reload; it counts as one protocol reply but adds no duplicate visible starter message. Renaming changes beta metadata, not the original message. Metadata reads and board thread choices use bounded concurrency; history decryption must not trigger a refetch loop.

Board pointer: state event `com.matchahoneylatte.kanban`, empty state key, `{version:1,event_id:"$board-root"}`.
Initial setup requires room state permission. Root timeline type is `com.matchahoneylatte.kanban.board`.
Card revisions use `com.matchahoneylatte.kanban.card` with version, card_id, title, description, column, archived, optional encrypted thread_id and an
`m.reference` relation to the root. SDK encryption applies to timeline payloads in encrypted rooms. Latest valid
server-ordered revision per card wins; simultaneous edits to one card use last-write-wins. Initial loading is bounded
to 100 revisions per board; partial history is labelled and Load older cards retrieves more.

Reminder commands: `!remind 10m Check build`, `!remind list`, `!remind cancel ID`. Units s/m/h/d, positive delay up to
365 days, text up to 2,000 characters. The requester can list/cancel only their own reminders in that room. The UI
requires explicit confirmation before inviting the bot and waits for it to join before sending a scheduling command.
A command is not confirmed scheduled until the bot acknowledges it.

## Deployment and maintenance

Target host is the existing `elements` machine on the user's Tailscale network. Use the authorised SSH configuration
and verify host identity before mutations. Main and beta have separate nginx virtual hosts and containers, sharing the
existing Matrix homeserver. Never reset a browser crypto store or copy a human access token between the two origins.

- Main container: `element-web`, official image `vectorim/element-web:v1.12.32`, loopback port82.
- Retained main rollback container: `element-web-rollback-1.12.5`, loopback port81; original config backup is on the host.
- Beta configuration: `/etc/element-web-beta/config.json`, mounted read-only at `/app/config.json`.
- Beta feature flags: `matcha_thread_tabs:true`, `matcha_reminder_bot:"@matcha-reminder:matchahoneylatte.com"`.
- Beta source link must point to `bouyant-dev/element-web/tree/matcha-beta`.
- Dedicated bot account is non-admin. Its protected password/token environment live under `/etc/matcha-reminder`.
- Preserve all bot schedules, sync state and crypto state. The intended container volume is `/var/lib/matcha-reminder/data:/data`, UID1000; the parent directory belongs to the service user and includes OS skeleton files.
- Allowed inviter IDs are stored in the server environment; do not automatically invite the bot into existing real chats.
- Follow `docs/matcha-beta.md` and `tools/matcha-reminder-bot/README.md` for build, update and rollback details.

The custom GitHub workflow checks upstream stable daily at03:23 Jakarta, tests/builds a merge before pushing, and
publishes `ghcr.io/bouyant-dev/element-web:beta` plus immutable build tags. Conflicts or failed checks stop updates.
GITHUB_TOKEN cannot push changes to workflow files; such upstream merges require a maintainer-assisted push. Do not
claim fully unattended updates across that boundary. GitHub publication and live deployment are separate proof levels.

## Tooling and safe continuation

Read `AGENTS.md`. Preserve the existing MVVM/Compound style, use pnpm and the locked dependencies, and do not hand-edit
package versions or tags. Use oxfmt/oxlint, not prettier. Generate i18n after copy changes. Agents must not open PRs.

Colima testcontainers need `DOCKER_HOST=unix:///Users/david/.colima/default/docker.sock` and
`TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. The user's registry login was expired; use a task-local
empty DOCKER_CONFIG for anonymous public test-image pulls rather than altering their login. Do not stop unrelated
Packing/chatbot containers. Run browser tests with CI=true against the built app; dev watchers can race and delete
shared declaration outputs. Only stop task-owned watchers.

Local preview assets are in the sibling `element-web-artifacts/` directory. Storybook's port6007 uses synthetic data.
Do not use screenshot fixtures as evidence of live deployment or live reminder delivery.

## Deployment status

Beta currently serves **`v1.12.32-matcha-cb0e435`**, built and tested locally, then uploaded directly. It runs as `element-web-beta` from `local/element-web-beta:cb0e435` on loopback port84. Image identity: `sha256:a94ce63f199bb8e1e3185e51029161ebc5ae2bcc9684cb020bc91f6000bab57d`. Release files: `/opt/element-web-beta/releases/cb0e435`; `current` points there. Public HTTPS `/version` and production homeserver configuration verified after routing.

The previous client is retained as `element-web-beta-rollback-6aea90d` on port83. Its nginx configuration is backed up at `/root/element-web-beta-backups/pre-cb0e435/nginx.conf`. Roll back only beta by restoring that proxy configuration, validating nginx and gracefully reloading; keep all Matrix data and bot storage. Main Element remains official1.12.32; Synapse process identity/start time stayed unchanged.

Current source commit `cb0e435` contains the functional changes; `2710da0` adds the final test fixture/acknowledgement checks without changing application code. All source is pushed to `bouyant-dev/element-web:matcha-beta`. The first previous-release GitHub workflow run39933437398 succeeded. Current deployments use local builds and do not wait for GitHub CI. No server auto-update timer exists; image publication does not automatically replace the running beta.

Latest validation:108 application/helper tests,16 Chromium view tests, types/lint, minified build, and three integrated browser scenarios passed. The ordinary-member encrypted case verifies named thread creation before user replies and reload, rename/reload, six threads with four tabs and complete history, archive/reload/restore at state power0, encrypted linked card fields, and correct source-thread opening from All boards. Tests wait for General selection and the server's decrypted archive acknowledgement before reloading; tab disappearance alone is ambiguous with a four-tab cap.

Reminder service remains deployed and persistent; source matches commit `e258dd7`. Separate disposable Synapse verification proved encrypted commands, acknowledgements and due delivery, including exactly-once delivery after a graceful restart. No production chats were used for test messages. The new thread/board release did not modify the reminder service.

Deployment tooling: when streaming a local bash script through stdin, use `ssh -n` for remote commands that need no input, otherwise SSH can consume subsequent scp commands. Verify the remote tarball SHA256 and Dockerfile existence before building. Use `COPYFILE_DISABLE=1 tar --no-xattrs` on macOS to avoid irrelevant Apple provenance headers. Do not remove browser encryption storage to refresh the app.
