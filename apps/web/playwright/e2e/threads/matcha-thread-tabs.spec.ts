/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { test, expect } from "../../element-web-test";
import type { Page, TestInfo } from "@playwright/test";
import type { EventType } from "matrix-js-sdk/src/matrix";

async function dismissPreviewPrompts(page: Page): Promise<void> {
    for (const name of ["Later", "Dismiss"]) {
        const toastAction = page.getByRole("button", { name, exact: true });
        if (await toastAction.isVisible()) {
            await toastAction.click();
            await expect(toastAction).not.toBeVisible();
        }
    }
    const introduction = page.getByRole("dialog").filter({ hasText: "Introducing Sections" });
    if (await introduction.isVisible()) {
        await introduction.getByRole("button", { name: "Ok", exact: true }).click();
        await expect(introduction).not.toBeVisible();
    }
}

async function capturePreview(page: Page, testInfo: TestInfo, filename: string): Promise<void> {
    await dismissPreviewPrompts(page);
    await page.screenshot({ path: testInfo.outputPath(filename), animations: "disabled" });
}

async function chooseMore(page: Page, label: string): Promise<void> {
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
}

test.describe("Matcha room thread tabs", () => {
    test.use({
        displayName: "Alice",
        viewport: { width: 1440, height: 900 },
        config: { matcha_thread_tabs: true, setting_defaults: { "language": "en-GB", "RoomList.showSections": false } },
        botCreateOpts: { displayName: "Bob", autoAcceptInvites: true },
    });

    test("switches conversations, sends a thread reply, archives and restores without deleting messages", async ({
        page,
        app,
        bot,
    }, testInfo) => {
        const roomId = await app.client.createRoom({ name: "Product & Engineering" });
        await app.client.evaluate((client, id) => client.setRoomTag(id, "m.favourite"), roomId);
        await app.client.inviteUser(roomId, bot.credentials!.userId);
        await bot.joinRoom(roomId);
        const root = await bot.sendMessage(roomId, "Project plans");
        await bot.sendMessage(roomId, "First thread reply", root.event_id);
        const design = await bot.sendMessage(roomId, "Design review");
        await bot.sendMessage(roomId, "Navigation mockups are ready for review.", design.event_id);
        const release = await bot.sendMessage(roomId, "Release checklist");
        await bot.sendMessage(roomId, "Check the beta before sharing it with the team.", release.event_id);
        await page.evaluate(
            (botUserId) => Object.assign(window.mxReactSdkConfig, { matcha_reminder_bot: botUserId }),
            bot.credentials!.userId,
        );
        await page.goto("/#/room/" + roomId);
        const navigation = page.getByRole("navigation", { name: "Room conversations" });
        await page
            .getByRole("navigation", { name: "Open threads" })
            .getByRole("button", { name: "Project plans", exact: true })
            .click();
        const threadConversation = page.getByRole("main").getByRole("complementary");
        await expect(threadConversation).toBeVisible();
        const composer = page.getByRole("textbox", { name: "Send an unencrypted message…" });
        await composer.fill("A reply from the main thread view");
        await composer.press("Enter");
        await expect(threadConversation.getByText("A reply from the main thread view", { exact: true })).toBeVisible();
        await capturePreview(page, testInfo, "thread-chat-preview.png");
        await chooseMore(page, "Set reminder");
        const reminderDialog = page.getByRole("dialog");
        await reminderDialog.getByRole("textbox").fill("10m Review the beta navigation");
        await reminderDialog.getByRole("heading", { name: "Set reminder", exact: true }).click();
        await expect(reminderDialog.getByRole("button", { name: "Request reminder", exact: true })).toBeEnabled();
        await expect(page.getByRole("tooltip")).toHaveCount(0);
        await capturePreview(page, testInfo, "reminder-preview.png");
        await reminderDialog.getByRole("button", { name: "Cancel", exact: true }).click();
        await page.getByRole("button", { name: "Thread actions", exact: true }).click();
        await page.getByRole("menuitem", { name: "Archive thread", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Archive thread", exact: true }).click();
        await expect(
            page
                .getByRole("navigation", { name: "Open threads" })
                .getByRole("button", { name: "Project plans", exact: true }),
        ).toHaveCount(0);
        await expect(navigation.getByRole("button", { name: "General" })).toHaveAttribute("aria-current", "page");
        await page.getByRole("button", { name: "Thread history", exact: true }).click();
        await page.getByRole("button", { name: "Restore thread", exact: true }).click();
        await page
            .getByRole("navigation", { name: "Open threads" })
            .getByRole("button", { name: "Project plans", exact: true })
            .click();
        await expect(threadConversation.getByText("First thread reply", { exact: true })).toBeVisible();
        await expect(threadConversation.getByText("A reply from the main thread view", { exact: true })).toBeVisible();
        await navigation.getByRole("button", { name: "General" }).click();
        await expect(composer).toBeVisible();
    });

    test("shares room cards, archives and restores them, and opens Personal from Home across joined rooms", async ({
        page,
        app,
        user,
    }, testInfo) => {
        expect(user.userId).toBeTruthy();
        const project = await app.client.createRoom({
            name: "Project",
            initial_state: [
                {
                    type: "m.room.encryption",
                    state_key: "",
                    content: { algorithm: "m.megolm.v1.aes-sha2" },
                },
            ],
        });
        const operations = await app.client.createRoom({ name: "Operations" });
        await app.client.evaluate((client, id) => client.setRoomTag(id, "m.favourite"), project);
        const createCard = async (roomId: string, title: string): Promise<void> => {
            await page.goto("/#/room/" + roomId);
            await page
                .getByRole("navigation", { name: "Room conversations" })
                .getByRole("button", { name: "Board", exact: true })
                .click();
            await page.getByRole("button", { name: "Create board", exact: true }).click();
            await page.getByRole("button", { name: "Add card", exact: true }).click();
            await page.getByRole("textbox", { name: "Card title" }).fill(title);
            await page
                .getByRole("textbox", { name: "Description (optional)" })
                .fill("Keep this card content after archiving.");
            await page.getByRole("button", { name: "Save card", exact: true }).click();
            await expect(page.getByRole("article", { name: title })).toBeVisible();
        };
        await createCard(project, "Ship beta navigation");
        for (const title of ["Review thread layout", "Connect the test workspace"]) {
            await page.getByRole("button", { name: "Add card", exact: true }).click();
            await page.getByRole("textbox", { name: "Card title" }).fill(title);
            await page.getByRole("button", { name: "Save card", exact: true }).click();
            await expect(page.getByRole("article", { name: title })).toBeVisible();
        }
        await page
            .getByRole("article", { name: "Connect the test workspace" })
            .getByRole("combobox", { name: "Status for Connect the test workspace" })
            .selectOption("done");
        const projectCard = page.getByRole("article", { name: "Ship beta navigation" });
        await projectCard.getByRole("combobox", { name: "Status for Ship beta navigation" }).selectOption("doing");
        await expect(
            page
                .getByRole("region", { name: "In progress", exact: true })
                .getByRole("article", { name: "Ship beta navigation" }),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "Add card", exact: true })).toBeEnabled();
        await capturePreview(page, testInfo, "room-board-preview.png");
        await projectCard.getByRole("button", { name: "Actions for Ship beta navigation" }).click();
        await page.getByRole("menuitem", { name: "Archive card", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Archive card", exact: true }).click();
        await expect(projectCard).toHaveCount(0);
        await page.getByRole("button", { name: "Archived cards", exact: true }).click();
        await projectCard.getByRole("button", { name: "Actions for Ship beta navigation" }).click();
        await page.getByRole("menuitem", { name: "Restore card", exact: true }).click();
        await page.getByRole("button", { name: "Active cards", exact: true }).click();
        await expect(projectCard).toContainText("Keep this card content after archiving.");
        const wire = await app.client.evaluate(async (client, roomId) => {
            const state = await client.getStateEvent(roomId, "com.matchahoneylatte.kanban", "");
            const root = await client.fetchRoomEvent(roomId, state.event_id);
            const updates = await client.fetchRelations(roomId, state.event_id, "m.reference", null, { limit: 50 });
            return { state, root, updates };
        }, project);
        expect(wire.root.type).toBe("m.room.encrypted");
        expect(wire.updates.chunk.length).toBeGreaterThan(0);
        expect(wire.updates.chunk.every((event) => event.type === "m.room.encrypted")).toBe(true);
        expect(JSON.stringify(wire)).not.toContain("Ship beta navigation");
        expect(JSON.stringify(wire)).not.toContain("Keep this card content after archiving.");
        await createCard(operations, "Check deployments");
        const spaces = page.getByRole("tree", { name: "Spaces" });
        const personal = spaces.getByRole("button", { name: "Personal", exact: true });
        await page.goto("/#/home");
        await expect(personal).toBeVisible();
        await personal.click();
        await expect(page).toHaveURL((url) => url.hash === "#/personal");
        await expect(spaces.getByRole("treeitem").filter({ has: personal })).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("article", { name: "Ship beta navigation" })).toBeVisible();
        await expect(page.getByRole("article", { name: "Check deployments" })).toBeVisible();
        await page.reload();
        await expect(page).toHaveURL((url) => url.hash === "#/personal");
        await expect(spaces.getByRole("treeitem").filter({ has: personal })).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("article", { name: "Ship beta navigation" })).toBeVisible();
        await expect(page.getByRole("article", { name: "Check deployments" })).toBeVisible();
        await capturePreview(page, testInfo, "all-boards-preview.png");
        await page
            .getByRole("article", { name: "Check deployments" })
            .getByRole("button", { name: "Open Operations", exact: true })
            .click();
        await expect(
            page
                .getByRole("navigation", { name: "Room conversations" })
                .getByRole("button", { name: "General", exact: true }),
        ).toHaveAttribute("aria-current", "page");
        await dismissPreviewPrompts(page);
        await personal.click();
        await projectCard.getByRole("button", { name: "Open Project", exact: true }).click();
        await expect(page).toHaveURL((url) => decodeURIComponent(url.hash) === "#/room/" + project);
        await personal.click();
        await spaces.getByRole("button", { name: "Home", exact: true }).click();
        await expect(page).toHaveURL((url) => url.hash === "#/home");
        await expect(spaces.getByRole("treeitem").filter({ has: personal })).toHaveAttribute("aria-selected", "false");
        await expect(page.getByRole("article", { name: "Ship beta navigation" })).toHaveCount(0);
    });
    test("manages named encrypted threads as a regular member and links them to cards", async ({
        page,
        app,
        bot,
        user,
    }, testInfo) => {
        test.setTimeout(120_000);
        // New room versions keep the creator privileged, so Alice is an invited member.
        const roomId = await bot.createRoom({
            name: "Release planning",
            invite: [user.userId],
            power_level_content_override: { users: { [user.userId]: 100 } },
            initial_state: [
                { type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } },
            ],
        });
        await app.client.joinRoom(roomId);
        await page.goto("/#/room/" + roomId);
        const roomNavigation = page.getByRole("navigation", { name: "Room conversations" });
        const threadTabs = page.getByRole("navigation", { name: "Open threads" });
        await roomNavigation.getByRole("button", { name: "Board", exact: true }).click();
        await page.getByRole("button", { name: "Create board", exact: true }).click();
        await expect(page.getByRole("button", { name: "Add card", exact: true })).toBeEnabled();
        await app.client.evaluate(
            async (client, args) => {
                const powers = await client.getStateEvent(args.roomId, args.powerType, "");
                await client.sendStateEvent(
                    args.roomId,
                    args.powerType,
                    {
                        ...powers,
                        users: { ...powers.users, [client.getSafeUserId()]: 0 },
                    },
                    "",
                );
            },
            { roomId, powerType: "m.room.power_levels" as EventType.RoomPowerLevels },
        );
        await expect
            .poll(() =>
                app.client.evaluate(
                    (client, id) =>
                        client
                            .getRoom(id)!
                            .currentState.maySendStateEvent(
                                "com.matchahoneylatte.thread_archive",
                                client.getSafeUserId(),
                            ),
                    roomId,
                ),
            )
            .toBe(false);
        await roomNavigation.getByRole("button", { name: "General", exact: true }).click();

        const newThread = async (name: string): Promise<void> => {
            await page.getByRole("button", { name: "New thread", exact: true }).click();
            const dialog = page.getByRole("dialog", { name: "New thread" });
            await dialog.getByRole("textbox", { name: "Thread name" }).fill(name);
            await dialog.getByRole("button", { name: "Create thread", exact: true }).click();
            await expect(threadTabs.getByRole("button", { name, exact: true })).toHaveAttribute("aria-current", "page");
        };
        await newThread("Release planning");
        const rootId = await app.client.evaluate(
            (client, id) =>
                client
                    .getRoom(id)!
                    .getThreads()
                    .find((thread) => thread.rootEvent?.getContent().body === "Release planning")!.id,
            roomId,
        );
        await page.reload();
        await expect(threadTabs.getByRole("button", { name: "Release planning", exact: true })).toBeVisible();
        await threadTabs.getByRole("button", { name: "Release planning", exact: true }).click();
        await page.getByRole("button", { name: "Thread actions", exact: true }).click();
        await page.getByRole("menuitem", { name: "Rename thread", exact: true }).click();
        const rename = page.getByRole("dialog", { name: "Rename thread" });
        await rename.getByRole("textbox", { name: "Thread name" }).fill("Release Q4");
        await rename.getByRole("button", { name: "Save", exact: true }).click();
        await expect(threadTabs.getByRole("button", { name: "Release Q4", exact: true })).toBeVisible();
        await page.reload();
        await expect(threadTabs.getByRole("button", { name: "Release Q4", exact: true })).toBeVisible();

        for (let i = 1; i <= 5; i++) await newThread("Topic " + i);
        await expect(threadTabs.getByRole("button", { name: /^(Release Q4|Topic [1-5])$/ })).toHaveCount(4);
        await expect(threadTabs.getByRole("button", { name: "Topic 5", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Thread history", exact: true }).click();
        const history = page.getByRole("region", { name: "Thread history", exact: true });
        await expect(history.getByRole("button", { name: /^(Release Q4|Topic [1-5])$/ })).toHaveCount(6);
        await history.getByRole("button", { name: "Release Q4", exact: true }).click();
        await expect(threadTabs.getByRole("button", { name: "Release Q4", exact: true })).toHaveAttribute(
            "aria-current",
            "page",
        );
        await expect(threadTabs.getByRole("button", { name: /^(Release Q4|Topic [1-5])$/ })).toHaveCount(4);

        await page.getByRole("button", { name: "Thread actions", exact: true }).click();
        await page.getByRole("menuitem", { name: "Link to board", exact: true }).click();
        await expect(page.getByRole("combobox", { name: "Linked thread (optional)" })).toHaveValue(rootId);
        await page.getByRole("textbox", { name: "Card title", exact: true }).fill("Ship release");
        await page.getByRole("button", { name: "Save card", exact: true }).click();
        const card = page.getByRole("article", { name: "Ship release", exact: true });
        await expect(card.getByRole("button", { name: "Open thread", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Refresh board", exact: true })).toHaveCount(0);
        await capturePreview(page, testInfo, "linked-board-preview.png");
        await card.getByRole("button", { name: "Open thread", exact: true }).click();
        await expect(threadTabs.getByRole("button", { name: "Release Q4", exact: true })).toHaveAttribute(
            "aria-current",
            "page",
        );
        await page.getByRole("button", { name: "Thread actions", exact: true }).click();
        await page.getByRole("menuitem", { name: "Archive thread", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Archive thread", exact: true }).click();
        await expect(roomNavigation.getByRole("button", { name: "General", exact: true })).toHaveAttribute(
            "aria-current",
            "page",
        );
        await expect
            .poll(() =>
                app.client.evaluate(
                    async (client, args) => {
                        const revisions = await client.fetchRelations(args.roomId, args.rootId, "m.reference", null, {
                            limit: 20,
                        });
                        for (const raw of revisions.chunk) {
                            const event = client.getEventMapper()({ ...raw, room_id: args.roomId });
                            await client.decryptEventIfNeeded(event);
                            if (
                                event.getType() === "com.matchahoneylatte.thread.metadata" &&
                                event.getContent().archived === true
                            )
                                return true;
                        }
                        return false;
                    },
                    { roomId, rootId },
                ),
            )
            .toBe(true);
        await expect(threadTabs.getByRole("button", { name: "Release Q4", exact: true })).toHaveCount(0);
        await page.reload();
        await page.getByRole("button", { name: "Thread history", exact: true }).click();
        const archived = history
            .getByRole("listitem")
            .filter({ has: page.getByRole("button", { name: "Release Q4", exact: true }) });
        await expect(archived).toContainText("Archived");
        await capturePreview(page, testInfo, "thread-history-live-preview.png");
        await archived.getByRole("button", { name: "Restore thread", exact: true }).click();
        await expect(threadTabs.getByRole("button", { name: "Release Q4", exact: true })).toBeVisible();
        await expect(page.getByRole("main").getByRole("complementary")).toBeVisible();

        const wire = await app.client.evaluate(
            async (client, args) => {
                const root = await client.fetchRoomEvent(args.roomId, args.rootId);
                const replies = await client.fetchRelations(args.roomId, args.rootId, "m.thread", null, { limit: 20 });
                const metadata = await client.fetchRelations(args.roomId, args.rootId, "m.reference", null, {
                    limit: 20,
                });
                const board = await client.getStateEvent(args.roomId, "com.matchahoneylatte.kanban", "");
                const cards = await client.fetchRelations(args.roomId, board.event_id, "m.reference", null, {
                    limit: 20,
                });
                return { root, replies, metadata, cards };
            },
            { roomId, rootId },
        );
        expect(wire.root.type).toBe("m.room.encrypted");
        expect(wire.replies.chunk.length).toBeGreaterThan(0);
        expect(wire.metadata.chunk.length).toBeGreaterThan(0);
        for (const batch of [wire.replies, wire.metadata, wire.cards]) {
            expect(batch.chunk.every((event) => event.type === "m.room.encrypted")).toBe(true);
        }
        expect(JSON.stringify(wire)).not.toContain("Release Q4");
        expect(JSON.stringify(wire)).not.toContain("Release planning");
        expect(JSON.stringify(wire.cards)).not.toContain(rootId);
        const otherRoom = await app.client.createRoom({ name: "Operations" });
        await page.goto("/#/room/" + otherRoom);
        await page.getByRole("tree", { name: "Spaces" }).getByRole("button", { name: "Personal", exact: true }).click();
        await expect(page).toHaveURL((url) => url.hash === "#/personal");
        await card.getByRole("button", { name: "Open thread", exact: true }).click();
        await expect(page).toHaveURL((url) => decodeURIComponent(url.hash) === "#/room/" + roomId);
        await expect(threadTabs.getByRole("button", { name: "Release Q4", exact: true })).toHaveAttribute(
            "aria-current",
            "page",
        );
        expect(user.userId).toBeTruthy();
    });
});
