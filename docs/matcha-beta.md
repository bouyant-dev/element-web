<!--
Copyright 2026 David
SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
-->

# Matcha beta maintenance

`matcha-beta` carries the custom Element Web client for
<https://beta-element.matchahoneylatte.com>. Its upstream is
<https://github.com/element-hq/element-web>; its fork is
<https://github.com/bouyant-dev/element-web>. This workflow changes the web client only.
Synapse and its database are outside its scope.

The `Matcha beta` workflow checks the official latest stable release every day at
03:23 Asia/Jakarta, on pushes to `matcha-beta`, and when run manually. GitHub may
delay scheduled runs. Release candidates, draft releases, and module release tags
are rejected. The job merges into a temporary runner branch, checks translations,
runs focused view-model, component, room, thread and browser tests, checks types,
and builds the client and runtime image. A conflict or failed check stops the run
before pushing the merge or publishing the image. No force push is used.

After the checks pass, the job pushes the verified merge to `matcha-beta`, then
publishes `ghcr.io/bouyant-dev/element-web:beta`. Each build also receives a unique
`sha-<full-commit>-<run-id>-<attempt>` tag and an OCI revision label. Unique tags
retain previous builds across retries; use the image digest or unique tag for a
rollback. `beta` is the moving deployment tag. A registry failure after the branch
push leaves the previous beta image in place; the next run retries publishing.

## GitHub setup

1. Make `matcha-beta` the fork's default branch. GitHub only schedules workflows
   from the default branch.
2. Enable Actions for the fork, then disable inherited upstream workflows in the
   repository's Actions settings. Enable only `matcha-beta.yml`. Disable them via
   GitHub settings/API, without editing upstream workflow files, so later merges
   keep the original upstream sources intact. Check again after an upstream merge
   introduces a new workflow.
3. Allow this workflow's `contents: write` and `packages: write` permissions. A
   branch rule requiring a PR or blocking Actions pushes will stop automatic
   merging safely; do not bypass repository rules silently.
4. After the first publication, make the GHCR `element-web` package public if the
   deployment host should pull without credentials. A public repository does not
   automatically make a new container package public. For a private package,
   configure a read-only registry credential on the deployment host.
5. Enable GitHub Actions failure notifications for the repository. Public-fork
   schedules can be disabled by GitHub after 60 days without repository activity;
   re-enable the workflow if GitHub disables it.

The built-in `GITHUB_TOKEN` is used, so its branch push does not recursively start
another build. It cannot update workflow files. If an upstream merge changes
`.github/workflows`, GitHub may reject the final push despite all checks passing.
The current beta image remains untouched. Review and push that merge with a
maintainer credential allowed to update workflows, then rerun `Matcha beta`.
Fully unattended merging across workflow changes requires a separately authorized
GitHub App or token with Contents and Workflows write permissions and a recursion
guard; this repository does not provision such a credential.

## Runtime and configuration

`Dockerfile.matcha-beta` inherits the exact official stable
`vectorim/element-web:<release>` runtime used as its source baseline. It replaces
`/app` with the tested custom build, preserving upstream nginx startup,
health-check behavior, and the `/app/config.json` configuration mount. The build
context contains only the generated web application.

Keep the deployment's existing homeserver and authentication configuration. Add
`"matcha_thread_tabs": true` to the beta client's mounted configuration to enable
General and thread tabs. Keep that flag off in the ordinary Element deployment.
Add the fork's source link to the existing `terms_and_conditions_links` list so
users can find it in Settings, Help & About, Legal. Preserve any existing links:

```json
{
    "matcha_thread_tabs": true,
    "terms_and_conditions_links": [
        {
            "text": "Matcha beta source code",
            "url": "https://github.com/bouyant-dev/element-web/tree/matcha-beta"
        }
    ]
}
```

The workflow publishes images only. The deployment host owns image rollout and
must verify the served `/version` and mounted `/config.json` after recreating the
beta container. Keep the last working image digest before updating. Roll back by
recreating only the beta web container with that digest and the same configuration
mount; no Synapse restart or database migration is needed.

For a local runtime build after the normal install, test, and production build:

```sh
docker build --file Dockerfile.matcha-beta \
  --build-arg ELEMENT_VERSION=v1.12.32 \
  --tag matcha-element-beta:local apps/web/webapp
```

Replace the example version with the official stable release used for the build.
Do not modify package versions or upstream Git tags by hand.

## Updating a conflicting release

Fetch `origin/matcha-beta` and the official stable tag into a clean worktree. Merge
the tag, resolve conflicts without dropping the thread-navigation changes, and run
the same focused checks and build listed in `matcha-beta.yml`. Review changes to
authentication, room permissions, thread relations, and archive state carefully.
Push the reviewed merge; the workflow checks it again before publishing. A missing
test file is a failure to fix, not permission to skip the test.

Reference behavior: [GitHub workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow),
[scheduled workflow limits](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
and [container package visibility](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
