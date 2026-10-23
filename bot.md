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

## Checkpoint and branch state

Before starting these changes, the deployed Personal release was checkpointed at
`8d7b478424b6d374c77b71dcbdc08be2eefcc308` on `checkpoint/personal-2026-10-23` and `main`, both pushed to
`bouyant-dev/element-web`. The fork had no `main`, so it was created at that complete checkpoint. New work was
implemented on `feature/room-docs` and fast-forwarded into `matcha-beta`; `main` remains the requested checkpoint.

The user reviewed vertical and horizontal navigation mockups and explicitly selected **B: one horizontal row**.
The synthetic interactive comparison is in the sibling `element-web-artifacts/navigation-design/` directory,
served locally at port6018. The deployed UI uses that horizontal direction, with a scrollable thread strip.

## Implemented behavior

- Favourites is the first room filter. Beta defaults `RoomList.showSections` to false; existing account preferences can override defaults.
- A compact **Chats / Docs** toggle lives in the left room list, below the filter chips and above the first chat. It is available only in a joined real Space. Docs routes to `#/room/<space>?view=docs`, survives reload/Back navigation, and Chats returns to the last joined child chat (Space home if unavailable). Home and Personal have no Space Docs toggle. More → Space docs uses the same route.
- One horizontal room toolbar contains General, Board, up to four thread tabs, New thread, Thread history and More. Shared Docs now belongs to the selected actual Matrix Space, rather than an individual chat. History includes every loaded active/archived thread and pagination. Named native threads support creation, rename, archive and restore. The native main-area timeline keeps encryption, composer, attachments and receipts.
- Each native thread projects to one Kanban card on its chat board. Add card creates its named thread. Changing a linked card title renames the thread, and archive/restore is shared with the thread selector without deleting messages. Existing standalone cards remain; duplicate older linked-card content is available under Earlier linked cards.
- Cards have optional local deadlines and a Remind action. Remind prefills the card title, deadline and thread permalink. Due dates alone do not schedule a bot message. The card records a requested time only; the bot acknowledgement confirms scheduling. Changing a deadline does not silently reschedule an already requested reminder.
- Personal is a permanent sidebar entry directly after Home. `#/personal` collects cards from currently joined chats, labels their source and opens the source chat/thread. Leaving a chat removes its cards. Background board updates preserve cards and drafts without refresh icons or loading flashes. Personal edits the shared source cards, not private copies.
- Docs is one shared Markdown document per actual Matrix Space. Space home has Rooms | Docs tabs; a contained chat offers More → Space docs only when a joined containing Space is explicitly selected. Nested/multiple-parent chats use that exact selected Space. Home, Personal and module pseudo-Spaces never select an arbitrary document.
- Spaces normally start unencrypted with events_default100. An administrator explicitly confirms Enable encrypted Docs once. The client enables Space timeline encryption, waits for SDK state acknowledgement, freshly reads power levels, sets only the Docs and m.room.encrypted timeline keys to0, and waits for sync before mounting the editor. Encryption is permanent; other power fields and child-chat permissions/encryption stay unchanged. No state writes happen on render or Check setup. No production Space was configured by the agent.
- Normal Space members then co-edit through CodeMirror6, Yjs13 and y-codemirror.next, with sanitized Markdown preview, saved/error status, retry and download. Earlier per-chat documents remain in their original chat and encryption boundary, accessible read-only/export through More → Earlier chat document. No automatic copy or migration into a wider Space audience occurs.
- Reminders have Remind me in (seconds/minutes/hours/days) or Remind me at (local date/time plus visible timezone), and a separate Message field. The dedicated bot persists schedules and posts in the same chat even when browsers are closed.
- No destructive thread deletion, automatic bot invitations, real-room test messages, or Synapse server upgrades/configuration changes are authorised.

## Design and verification

The first board design was rejected. A dedicated designer revised it and an independent reviewer rated the final
rendered UI **8.2/10** across full Element, narrow, mobile and dark-mode screenshots. The final design uses compact
cards, source-chat chips, status dropdowns and a single compact room toolbar. Do not reintroduce stacked action links.
This score is a visual review, not full assistive-technology certification.

For the Docs/task/reminder release, these checks passed:

- 161 focused app, model, transport, rendering, native-room and thread tests.
- 23 Chromium component tests, application/browser TypeScript checks, focused lint/format and workflow syntax.
- 17 reminder-service tests in Linux Node24, repeated against the actual deployment runtime image.
- Four integrated browser scenarios on disposable Synapse; after the final CSS polish, the Docs and named-thread/card scenarios passed again against the final minified bundle.
- Two independently signed-in ordinary members edited the same encrypted Docs document simultaneously, converged, reloaded, and recovered a failed send across General/Docs navigation. Raw stored updates were encrypted, with no document text or custom document state.
- Thread/card tests cover one-to-one automatic projection, rename/archive/restore, deadlines, a prefilled reminder request, cross-chat Personal navigation, and encrypted card deadline/request metadata.
- A separate real encrypted reminder test on Node24.22.1 delivered a12-second relative reminder and an exact UTC reminder after graceful bot restart. The exact reminder arrived758ms after its deadline; both commands, acknowledgements and deliveries were Megolm-encrypted. Two records ended sent with one observed delivery each and no decryption failures. Evidence: `/Users/david/.codex/tmp/matcha-reminder-exact.mktb6oex/evidence.json`.

The subsequent Space Docs/recovery release passed141 focused app tests and16 Chromium view tests, plus77 overlapping encrypted-content regression tests covering the actual SDK retry path. App/browser types, lint/format, production build and workflow syntax passed. Three existing thread/board browser scenarios passed. The new real-Space scenario passed after correcting a test locator: it confirms explicit admin setup, preservation of unrelated power levels, two power0 members editing from different private child chats, reload/retry, ciphertext stored only on the Space anchor, and an earlier private child document exported unchanged and inaccessible to the other member. The first run's4-minute wait was a locator looking for More inside the wrong nav group; the same application bundle passed once the selector was corrected and action timeouts bounded.

A deployment build must use a unique commit-derived VERSION and normal minification. Do not set CI_PACKAGE for the
published build: upstream uses that flag to disable minification for fast CI test bundles.

## Source map and protocols

- `apps/web/src/components/structures/RoomView.tsx`: main-area integration.
- `apps/web/src/components/structures/{MatrixChat,LoggedInView}.tsx` and `apps/web/src/components/views/spaces/{SpacePanel,SpaceTreeLevel}.tsx`: Personal routing, rendering, and permanent sidebar navigation.
- `apps/web/src/viewmodels/room/RoomThreadTabsViewModel.ts`: thread tabs and archive.
- `apps/web/src/viewmodels/room/KanbanBoardViewModel.ts`: boards, permissions, pagination and decrypted revisions.
- `packages/shared-components/src/room/{RoomThreadTabs,KanbanBoard}`: presentation, stories and component tests.
- `apps/web/src/utils/matcha/reminders.ts`, `RoomReminderViewModel.ts`, and `packages/shared-components/src/room/RoomReminder`: structured reminder form, validation and bot requests.
- `apps/web/src/utils/matcha/documents.ts`, `RoomDocsViewModel.ts`, `components/views/rooms/RoomDocs.tsx`, and `packages/shared-components/src/room/RoomDocs`: live Markdown transport, model, CodeMirror adapter and preview.
- `apps/web/src/components/structures/SpaceRoomView.tsx`, `components/views/rooms/SpaceDocs.tsx`, `SpaceDocsViewModel.ts`, and shared `room/SpaceDocsSetup`: Space-owned document view and explicitly confirmed encrypted setup.
- `apps/web/src/utils/matcha/spaceDocuments.ts`: resolves only the selected containing Space; never guesses a parent.
- `apps/web/src/utils/matcha/encryption.ts`: shared SDK44 cached-decryption recovery for threads, boards and Docs.
- `apps/web/playwright/e2e/room/matcha-docs.spec.ts`: real encrypted Space setup, two ordinary members across private child chats, retry and earlier-document privacy/export proof.
- `apps/web/playwright/e2e/threads/matcha-thread-tabs.spec.ts`: integrated synthetic scenarios and preview captures.
- `tools/matcha-reminder-bot`: standalone Node 24 service, its own npm lockfile and Dockerfile.

Thread metadata: encrypted timeline event `com.matchahoneylatte.thread.metadata`, related to the native root with `m.reference`, containing `{version:1,name?:string,archived?:boolean}`. Reads resolve the latest independent field patches in server order. Legacy state `com.matchahoneylatte.thread_archive` is read only as a fallback. No new title/body/archive flag is written to room state and no redaction is performed.

New thread creation sends the named root plus a hidden custom `m.thread` bootstrap event. That establishes native server aggregation before any user reply and survives reload; it counts as one protocol reply but adds no duplicate visible starter message. Renaming changes beta metadata, not the original message. Metadata reads and board thread choices use bounded concurrency; history decryption must not trigger a refetch loop.

SDK44's decryptEventIfNeeded skips cached m.bad.encrypted events, so simply retrying the same mapped object does not invoke crypto again. The shared helper retries a fresh MatrixEvent from the original encrypted wire data through the public SDK API. No crypto-store reset or private backend API is used. Thread warnings distinguish missing keys, other decryption failures, connection failures, incomplete history and access failures. Successful key recovery during another metadata batch is processed; deleted-thread errors are pruned. Unreadable metadata remains unmanageable, but native thread navigation is allowed for replies that may still be readable. This cannot reconstruct keys absent from devices/backups.

Board pointer: state event `com.matchahoneylatte.kanban`, empty state key, `{version:1,event_id:"$board-root"}`.
Initial setup requires room state permission. Root timeline type is `com.matchahoneylatte.kanban.board`.
Card revisions use `com.matchahoneylatte.kanban.card` with version, card_id, title, description, column, archived, optional encrypted thread_id, due_at and reminder_requested fields and an
`m.reference` relation to the root. SDK encryption applies to timeline payloads in encrypted rooms. Latest valid
server-ordered revision per card wins; simultaneous edits to one card use last-write-wins. Initial loading is bounded
to 100 revisions per board; partial history is labelled and Load older cards retrieves more.

Docs updates use encrypted timeline type `com.matchahoneylatte.docs.update`, related by `m.reference` to the Space's existing `m.room.create` event. Earlier chat documents retain their original chat anchors and are not migrated. Payloads contain version1, doc main, update_id, kind update/chunk/commit, chunks, optional chunk/data and the relation. Yjs updates are base64 encoded; large updates split into16KiB parts and become valid only after a commit marker. Every accessible history page is replayed before editing; missing keys, committed parts or Yjs causal dependencies keep editing disabled until recovered. The Yjs13.6.33 causal guard uses its typed pendingStructs/pendingDs fields; revalidate it before changing that dependency.

Docs sends debounce500ms, and Saved appears only after server acknowledgement. Pending sessions survive tab/room navigation and retry the same Matrix transaction IDs. Unacknowledged edits are memory-only: an unload warning and Markdown download provide recovery, but forced browser/process exit can still lose unsent edits. Never describe this as durable offline storage. Do not optimize history by trusting a snapshot timestamp or putting document plaintext in room state.

Reminder commands: `!remind 10m Check build`, `!remind at <UTC ISO timestamp> Check build`, `!remind list`, `!remind cancel ID`. Units s/m/h/d, positive delay up to
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

Beta currently serves **`v1.12.32-matcha-6856ce9a72`**, built/tested locally and uploaded directly. Container `element-web-beta` uses `local/element-web-beta:6856ce9a72` on loopback port87. Image identity: `sha256:13b257b55d33d2d93dd4a2c78750380bab8aa1abcca68727f474752be8d94dc4`. Release `/opt/element-web-beta/releases/6856ce9a72`; `current` points there. Archive SHA256: `c1dd595184818e10c45b82f771c1d6358b8805e7414e21e41c29c72209681b9c`. Public HTTPS version, healthy runtime and existing production homeserver configuration verified.

The previous UI is retained as `element-web-beta-rollback-aa12001102` on port86. Nginx backup: `/root/element-web-beta-backups/pre-6856ce9a72/nginx.conf`. Restore that proxy config, validate and gracefully reload to roll back the UI. Rolling back UI code does not undo a Space's administrator-confirmed encryption/permissions or move its document data. Main Element remains official1.12.32; Synapse stayed PID1931360 with start time2026-10-22 06:43:31UTC. The reminder bot was not changed in this release.

The updated reminder bot was deployed before the UI and remains backward-compatible with old relative commands. It runs `local/matcha-reminder:263d79baa3`, image `sha256:86b1c49b211d2dd634a25f8521925e7a6f24f29b31afac7de169c7b5128ef16b`, with the same protected environment and `/var/lib/matcha-reminder/data` bind mount. It started successfully with zero restarts. Existing record counts, crypto directory and sync file were verified preserved; no schema migration was added. The stopped rollback container is `matcha-reminder-bot-rollback-82969ef255f57ad6`. Protected backup `/root/matcha-reminder-backups/pre-263d79baa3` contains the old container configuration and consistent data archive. Never run two bot containers against the shared store. Do not restore an old data archive over newer schedules merely to roll back code.

Recovery commit `85b8fce4df`, Space Docs source `6856ce9a72`, and test-only correction `204d09e13a` are pushed to `bouyant-dev/element-web:matcha-beta`. Live rollout used the local build and did not wait for GitHub CI. The upstream workflow publishes images but does not automatically replace the running beta; no server auto-update timer exists.

Deployment tooling: when streaming a local bash script through stdin, use `ssh -n` for remote commands that need no input, otherwise SSH can consume subsequent scp commands. Verify the remote tarball SHA256 and Dockerfile existence before building. Use `COPYFILE_DISABLE=1 tar --no-xattrs` on macOS to avoid irrelevant Apple provenance headers. Do not remove browser encryption storage to refresh the app.

Nginx reload returns before new workers necessarily serve requests. Poll the routed `/version` for the expected release for up to15seconds before declaring rollout failure; a single immediate read can still hit the old worker. The rollback guard was exercised and the final routed/public versions both matched.
