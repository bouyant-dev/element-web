<!--
Copyright 2026 David
SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
-->

# Matcha reminder bot

A separate Matrix client that keeps room reminders running while browsers are
closed. It uses the existing homeserver; it requires no Synapse change and opens
no HTTP port. Run exactly one process per bot account and data directory.

Invite the bot to a room from an allowed account, wait until it joins, then send:

```text
!remind 10m Check the build
!remind 2h Review the Kanban board
!remind list
!remind cancel r-0123456789abcdef
```

The scheduling reply contains the real cancellation ID. Delays are positive
whole numbers followed by `s`, `m`, `h`, or `d`, up to 365 days. Reminder text is
limited to 2,000 characters. A user can have 100 pending reminders per room;
the limits are 1,000 per room and 10,000 overall. More than 30 commands from the
same user in one room within a minute are ignored. Lists and cancellation apply
only to the requester in that room; moderators cannot cancel another user's
reminder. The list shows the next 20 reminders, with UTC timestamps.

The due time is based on the original Matrix message timestamp. An unprocessed
command whose due time has passed is rejected with a notice. Already accepted
reminders that become overdue during downtime are delivered after restart.
Old room history and rooms not admitted through an allowed invitation cannot
create reminders. Invitation admission is persisted before joining, and sync
progress is persisted only after commands have been written to SQLite.

## Runtime

Use Node 24 and the standalone npm lockfile. This directory is intentionally
outside Element's pnpm workspaces. `npm ci` must run dependency install scripts:
the official crypto package downloads its native library during installation.

Required environment variables:

| Variable              | Value                                                             |
| --------------------- | ----------------------------------------------------------------- |
| `MATRIX_HOMESERVER`   | HTTPS Matrix homeserver base URL                                  |
| `MATRIX_ACCESS_TOKEN` | Token for the dedicated, non-admin bot account                    |
| `ALLOWED_INVITERS`    | Comma-separated exact Matrix user IDs permitted to invite the bot |
| `DATA_DIR`            | Absolute path to persistent storage; `/data` in the image         |

Keep credentials in a root-owned environment file outside the repository. Mount
the data directory persistently, writable by UID 1000 (`node`), with private
permissions. It contains the SQLite reminder database, sync state and Rust SDK
encryption keys. Back up the entire directory together while the service is
stopped. Reminder text is plaintext in this private local database; room messages
and replies use Matrix encryption when the room is encrypted.

```sh
npm ci
npm test
npm start
```

Or, from this directory:

```sh
docker build -t matcha-reminder-bot:local .
docker run -d --name matcha-reminder-bot --restart unless-stopped \
  --env-file /etc/matcha-reminder/environment \
  --volume /var/lib/matcha-reminder:/data \
  matcha-reminder-bot:local
```

Acknowledgements and due reminders retry with capped exponential backoff and a
stable Matrix transaction ID. An uncertain send can safely be retried after a
crash while the same bot access token is retained. Do not rotate the access token
mid-recovery without checking pending deliveries: Matrix deduplication is scoped
to the token/session. Failed delivery never removes the schedule. The worker
posts due reminders as messages mentioning the requester; acknowledgements are
notices. Encryption failures never trigger a plaintext fallback.

Keep the data directory when replacing the container. Removing it loses schedules,
room admission, sync position, and encryption keys. When moving to a new bot
identity or intentionally resetting storage, remove and reinvite the bot so each
room gets an explicit new admission cutoff. SDK request bodies and credentials
are omitted from logs. A processing failure exits the process for the container
restart policy to recover from the saved sync position.

The Node tests cover schedule persistence, replay, scopes, bounds, rate limits,
cancellation, uncertain delivery retries, encryption dispatch, invitation gates,
and awaited sync processing. They use temporary databases and a fake transport;
they do not prove encryption or delivery against a live homeserver.
