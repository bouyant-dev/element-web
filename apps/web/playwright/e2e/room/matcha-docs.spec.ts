/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { readFile } from "node:fs/promises";
import { createNewInstance } from "@element-hq/element-web-playwright-common";
import type { Locator, Page, Route } from "@playwright/test";
import type { EventType, Preset } from "matrix-js-sdk/src/matrix";
import * as Y from "yjs";

import { test, expect } from "../../element-web-test";
import { ElementAppPage } from "../../pages/ElementAppPage";

const config = {
    matcha_thread_tabs: true,
    setting_defaults: { "language": "en-GB", "RoomList.showSections": false },
};
const SPACE_NAME = "Collaborative Space docs";
const ALICE_CHAT = "Alice private project";
const BOB_CHAT = "Bob private project";
const DOC_EVENT = "com.matchahoneylatte.docs.update";
const legacyMarkdown = "# Legacy private plan\n\nOnly Alice's original chat can read these notes.\n";

async function dismissPrompts(page: Page): Promise<void> {
    for (const name of ["Later", "Dismiss"]) {
        const action = page.getByRole("button", { name, exact: true });
        if (await action.isVisible()) await action.click();
    }
    const introduction = page.getByRole("dialog").filter({ hasText: "Introducing Sections" });
    if (await introduction.isVisible()) {
        await introduction.getByRole("button", { name: "Ok", exact: true }).click();
    }
}

async function openSpaceDocs(app: ElementAppPage, page: Page, chat: string, waitForEditable = true): Promise<Locator> {
    await dismissPrompts(page);
    await app.viewSpaceByName(SPACE_NAME);
    await app.viewRoomByName(chat);
    const navigation = page.getByRole("navigation", { name: "Room conversations" });
    await expect(navigation.getByRole("button", { name: "Docs", exact: true })).toHaveCount(0);
    const spaceNavigation = page
        .getByRole("navigation", { name: "Room list", exact: true })
        .getByRole("navigation", { name: "Space content", exact: true });
    await expect(spaceNavigation.getByRole("button", { name: "Chats", exact: true })).toHaveAttribute(
        "aria-current",
        "page",
    );
    await spaceNavigation.getByRole("button", { name: "Docs", exact: true }).click();
    await expect(spaceNavigation.getByRole("button", { name: "Docs", exact: true })).toHaveAttribute(
        "aria-current",
        "page",
    );
    await expect(spaceNavigation.getByRole("button", { name: "Chats", exact: true })).not.toHaveAttribute(
        "aria-current",
        "page",
    );
    const region = page.getByRole("region", { name: "Docs", exact: true });
    await expect(region).toContainText(SPACE_NAME);
    const editor = region.getByRole("textbox", { name: "Markdown document", exact: true });
    await expect(editor).toBeVisible();
    if (waitForEditable) await expect(editor).toBeEditable();
    return editor;
}

test.describe("Matcha shared Space Docs", () => {
    test.use({
        displayName: "Alice",
        actionTimeout: 15_000,
        viewport: { width: 1440, height: 900 },
        config,
        botCreateOpts: { displayName: "Space owner", autoAcceptInvites: true },
    });

    test("explicitly enables encrypted Space Docs, lets ordinary members collaborate across child chats, and preserves private earlier docs", async ({
        app: alice,
        page: alicePage,
        user: aliceCredentials,
        browser,
        homeserver,
        labsFlags,
        bot,
    }, testInfo) => {
        test.setTimeout(240_000);
        await alice.client.bootstrapCrossSigning(aliceCredentials);
        await alice.closeKeyStorageToast();
        const bobCredentials = await homeserver.registerUser(
            `user_${testInfo.testId}_space_docs_bob`,
            "password",
            "Bob",
        );
        const bobPage = await createNewInstance(browser, bobCredentials, config, labsFlags);
        const bob = new ElementAppPage(bobPage);
        try {
            await bob.client.bootstrapCrossSigning(bobCredentials);
            await bob.closeKeyStorageToast();
            const [aliceChatId, bobChatId] = await Promise.all([
                bot.createRoom({
                    name: ALICE_CHAT,
                    preset: "private_chat" as Preset,
                    invite: [aliceCredentials.userId],
                    initial_state: [
                        { type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } },
                    ],
                }),
                bot.createRoom({
                    name: BOB_CHAT,
                    preset: "private_chat" as Preset,
                    invite: [bobCredentials.userId],
                    initial_state: [
                        { type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } },
                    ],
                }),
            ]);
            // Real Spaces start unencrypted and restrict timeline events. Setup must preserve these general restrictions.
            const spaceId = await bot.createSpace({
                name: SPACE_NAME,
                preset: "private_chat" as Preset,
                invite: [aliceCredentials.userId, bobCredentials.userId],
                power_level_content_override: {
                    users: { [aliceCredentials.userId]: 100 },
                    users_default: 0,
                    events_default: 100,
                    state_default: 50,
                    invite: 50,
                    events: { "m.room.power_levels": 100, "m.room.encryption": 100, "com.example.restricted": 75 },
                },
                initial_state: [aliceChatId, bobChatId].map((roomId) => ({
                    type: "m.space.child",
                    state_key: roomId,
                    content: { via: [aliceCredentials.homeServer] },
                })),
            });
            await bot.evaluate(
                async (client, { spaceId, childIds, via }) => {
                    for (const roomId of childIds)
                        await client.sendStateEvent(
                            roomId,
                            "m.space.parent" as EventType.SpaceParent,
                            { via: [via], canonical: true },
                            spaceId,
                        );
                },
                { spaceId, childIds: [aliceChatId, bobChatId], via: aliceCredentials.homeServer },
            );
            await Promise.all([
                alice.client.joinRoom(spaceId),
                bob.client.joinRoom(spaceId),
                alice.client.joinRoom(aliceChatId),
                bob.client.joinRoom(bobChatId),
            ]);
            for (const member of [alice, bob]) {
                await expect
                    .poll(() => member.client.evaluate((client, id) => client.getRoom(id)?.getMyMembership(), spaceId))
                    .toBe("join");
            }
            for (const [member, roomId] of [
                [alice, aliceChatId],
                [bob, bobChatId],
            ] as const) {
                await expect
                    .poll(() =>
                        member.client.evaluate((client, id) => {
                            const room = client.getRoom(id);
                            return {
                                joined: room?.getMyMembership(),
                                encrypted: room?.hasEncryptionStateEvent(),
                                anchor: !!room?.currentState
                                    .getStateEvents("m.room.create" as EventType.RoomCreate, "")
                                    ?.getId(),
                            };
                        }, roomId),
                    )
                    .toEqual({ joined: "join", encrypted: true, anchor: true });
            }
            const originalSettings = await alice.client.evaluate((client, id) => {
                const space = client.getRoom(id)!;
                return {
                    encrypted: space.hasEncryptionStateEvent(),
                    type: space.getType(),
                    powers: space.currentState
                        .getStateEvents("m.room.power_levels" as EventType.RoomPowerLevels, "")!
                        .getContent(),
                };
            }, spaceId);
            expect(originalSettings).toMatchObject({
                encrypted: false,
                type: "m.space",
                powers: {
                    events_default: 100,
                    state_default: 50,
                    invite: 50,
                    events: { "com.example.restricted": 75 },
                },
            });
            await expect
                .poll(() =>
                    bob.client.evaluate(
                        (client, id) =>
                            client
                                .getRoom(id)!
                                .currentState.maySendEvent("com.matchahoneylatte.docs.update", client.getSafeUserId()),
                        spaceId,
                    ),
                )
                .toBe(false);

            // Seed an earlier encrypted child-chat document. It must never be copied into the shared Space document.
            const legacy = new Y.Doc();
            legacy.getText("markdown").insert(0, legacyMarkdown);
            const legacyData = Buffer.from(Y.encodeStateAsUpdate(legacy)).toString("base64");
            legacy.destroy();
            const legacyEventId = await alice.client.evaluate(
                async (client, { roomId, data }) => {
                    const room = client.getRoom(roomId)!;
                    const anchor = room.currentState
                        .getStateEvents("m.room.create" as EventType.RoomCreate, "")!
                        .getId()!;
                    const result = await client.sendEvent(roomId, "com.matchahoneylatte.docs.update", {
                        "version": 1,
                        "doc": "main",
                        "kind": "update",
                        "update_id": "legacy-private-seed",
                        "chunk": 0,
                        "chunks": 1,
                        data,
                        "m.relates_to": { rel_type: "m.reference", event_id: anchor },
                    });
                    return result.event_id;
                },
                { roomId: aliceChatId, data: legacyData },
            );

            await dismissPrompts(alicePage);
            await alice.viewSpaceHomeByName(SPACE_NAME);
            const roomList = alicePage.getByRole("navigation", { name: "Room list", exact: true });
            const spaceNavigation = roomList.getByRole("navigation", { name: "Space content", exact: true });
            const chatsToggle = spaceNavigation.getByRole("button", { name: "Chats", exact: true });
            const docsToggle = spaceNavigation.getByRole("button", { name: "Docs", exact: true });
            const firstChat = roomList
                .getByRole("listbox", { name: "Room list", exact: true })
                .getByRole("option")
                .first();
            await expect(chatsToggle).toHaveAttribute("aria-current", "page");
            await expect(firstChat).toBeVisible();
            await expect(firstChat).toContainText(ALICE_CHAT);
            await expect
                .poll(async () => {
                    const [filters, toggle, chat] = await Promise.all([
                        roomList.getByRole("listbox", { name: "Room list filters", exact: true }).boundingBox(),
                        spaceNavigation.boundingBox(),
                        firstChat.boundingBox(),
                    ]);
                    return (
                        !!filters &&
                        !!toggle &&
                        !!chat &&
                        filters.y + filters.height <= toggle.y &&
                        toggle.y + toggle.height <= chat.y
                    );
                })
                .toBe(true);
            await docsToggle.click();
            await expect(alicePage).toHaveURL((url) => decodeURIComponent(url.hash) === `#/room/${spaceId}?view=docs`);
            await expect(docsToggle).toHaveAttribute("aria-current", "page");
            await expect(alicePage.getByRole("textbox", { name: "Markdown document", exact: true })).toHaveCount(0);
            await alicePage.getByRole("button", { name: "Enable encrypted Docs", exact: true }).click();
            const setup = alicePage.getByRole("dialog", { name: "Enable encrypted Docs", exact: true });
            await expect(setup).toContainText(SPACE_NAME);
            // Nothing changes merely by opening the confirmation.
            expect(
                await alice.client.evaluate((client, id) => client.getRoom(id)!.hasEncryptionStateEvent(), spaceId),
            ).toBe(false);
            await setup.getByRole("button", { name: "Enable encrypted Docs", exact: true }).click();
            await expect(alicePage.getByRole("textbox", { name: "Markdown document", exact: true })).toBeEditable();
            await expect
                .poll(() =>
                    alice.client.evaluate((client, id) => {
                        const space = client.getRoom(id)!;
                        const powers = space.currentState
                            .getStateEvents("m.room.power_levels" as EventType.RoomPowerLevels, "")!
                            .getContent();
                        return {
                            encrypted: space.hasEncryptionStateEvent(),
                            docs: powers.events?.["com.matchahoneylatte.docs.update"],
                            encryptedEvents: powers.events?.["m.room.encrypted"],
                            eventsDefault: powers.events_default,
                            stateDefault: powers.state_default,
                            restricted: powers.events?.["com.example.restricted"],
                            invite: powers.invite,
                        };
                    }, spaceId),
                )
                .toEqual({
                    encrypted: true,
                    docs: 0,
                    encryptedEvents: 0,
                    eventsDefault: 100,
                    stateDefault: 50,
                    restricted: 75,
                    invite: 50,
                });

            // Alice needed administration only for the explicit one-time setup. Both editors are ordinary members below.
            await bot.evaluate(
                async (client, { id, userId }) => {
                    const powers = await client.getStateEvent(
                        id,
                        "m.room.power_levels" as EventType.RoomPowerLevels,
                        "",
                    );
                    await client.sendStateEvent(
                        id,
                        "m.room.power_levels" as EventType.RoomPowerLevels,
                        { ...powers, users: { ...powers.users, [userId]: 0 } },
                        "",
                    );
                },
                { id: spaceId, userId: aliceCredentials.userId },
            );
            for (const member of [alice, bob]) {
                await expect
                    .poll(() =>
                        member.client.evaluate((client, id) => {
                            const space = client.getRoom(id)!;
                            return {
                                power: space.currentState.getMember(client.getSafeUserId())?.powerLevel,
                                mayWriteDocs: space.currentState.maySendEvent(
                                    "com.matchahoneylatte.docs.update",
                                    client.getSafeUserId(),
                                ),
                                mayWriteState: space.currentState.maySendStateEvent(
                                    "m.room.name" as EventType.RoomName,
                                    client.getSafeUserId(),
                                ),
                            };
                        }, spaceId),
                    )
                    .toEqual({ power: 0, mayWriteDocs: true, mayWriteState: false });
            }

            const [aliceEditor, bobEditor] = await Promise.all([
                openSpaceDocs(alice, alicePage, ALICE_CHAT),
                openSpaceDocs(bob, bobPage, BOB_CHAT),
            ]);
            const aliceDocs = alicePage.getByRole("region", { name: "Docs", exact: true });
            const bobDocs = bobPage.getByRole("region", { name: "Docs", exact: true });
            await expect(aliceEditor).not.toContainText("Legacy private plan");
            await aliceEditor.fill("# Shared plan\n\n**Release checklist**\n");
            await expect(bobEditor).toContainText("Release checklist");
            await expect(aliceDocs.getByRole("status")).toHaveText("Saved");

            // Both paste before the 500ms send debounce can publish either edit.
            await Promise.all([aliceEditor.press("ControlOrMeta+End"), bobEditor.press("ControlOrMeta+End")]);
            await Promise.all([
                alicePage.keyboard.insertText("\nAlice contribution to the shared plan.\n"),
                bobPage.keyboard.insertText("\nBob contribution to the shared plan.\n"),
            ]);
            for (const editor of [aliceEditor, bobEditor]) {
                await expect(editor).toContainText("Alice contribution");
                await expect(editor).toContainText("Bob contribution");
            }
            await expect.poll(async () => (await aliceEditor.innerText()) === (await bobEditor.innerText())).toBe(true);
            await expect(aliceDocs.getByRole("status")).toHaveText("Saved");
            await expect(bobDocs.getByRole("status")).toHaveText("Saved");

            await chatsToggle.click();
            await expect(alicePage).toHaveURL((url) => decodeURIComponent(url.hash) === `#/room/${aliceChatId}`);
            await expect(chatsToggle).toHaveAttribute("aria-current", "page");
            await expect(docsToggle).not.toHaveAttribute("aria-current", "page");
            await alicePage.goBack();
            await expect(alicePage).toHaveURL((url) => decodeURIComponent(url.hash) === `#/room/${spaceId}?view=docs`);
            await expect(docsToggle).toHaveAttribute("aria-current", "page");
            await alicePage.goForward();
            await expect(chatsToggle).toHaveAttribute("aria-current", "page");
            await docsToggle.click();
            await firstChat.click();
            await expect(alicePage).toHaveURL((url) => decodeURIComponent(url.hash) === `#/room/${aliceChatId}`);
            await expect(chatsToggle).toHaveAttribute("aria-current", "page");
            await expect(aliceDocs).toHaveCount(0);
            // The existing chat shortcut reaches the same Space route and selected sidebar toggle.
            await alicePage.getByRole("button", { name: "More", exact: true }).click();
            await alicePage.getByRole("menuitem", { name: "Space docs", exact: true }).click();
            await expect(alicePage).toHaveURL((url) => decodeURIComponent(url.hash) === `#/room/${spaceId}?view=docs`);
            await expect(docsToggle).toHaveAttribute("aria-current", "page");
            await expect(aliceEditor).toContainText("Alice contribution");
            await aliceDocs.getByRole("button", { name: "Preview", exact: true }).click();
            await expect(aliceDocs.getByRole("heading", { name: "Shared plan", exact: true })).toBeVisible();
            await alicePage.screenshot({
                path: testInfo.outputPath("space-docs-live-preview.png"),
                animations: "disabled",
            });
            await aliceDocs.getByRole("button", { name: "Edit Markdown", exact: true }).click();

            await Promise.all([alicePage.reload(), bobPage.reload()]);
            for (const page of [alicePage, bobPage]) {
                await dismissPrompts(page);
                await expect(page).toHaveURL((url) => decodeURIComponent(url.hash) === `#/room/${spaceId}?view=docs`);
                await expect(
                    page
                        .getByRole("navigation", { name: "Space content", exact: true })
                        .getByRole("button", { name: "Docs", exact: true }),
                ).toHaveAttribute("aria-current", "page");
            }
            for (const editor of [aliceEditor, bobEditor]) {
                await expect(editor).toBeEditable();
                await expect(editor).toContainText("Alice contribution");
                await expect(editor).toContainText("Bob contribution");
            }
            await expect.poll(async () => (await aliceEditor.innerText()) === (await bobEditor.innerText())).toBe(true);

            let rejectedSends = 0;
            const rejectSend = async (route: Route): Promise<void> => {
                rejectedSends++;
                await route.fulfill({
                    status: 403,
                    contentType: "application/json",
                    body: JSON.stringify({ errcode: "M_FORBIDDEN", error: "Simulated send failure" }),
                });
            };
            await alicePage.route("**/send/m.room.encrypted/**", rejectSend);
            await aliceEditor.press("ControlOrMeta+End");
            await alicePage.keyboard.insertText("\nUnsent change survives navigation and retry.\n");
            await expect.poll(() => rejectedSends).toBeGreaterThan(0);
            await expect(aliceDocs.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
            await expect(aliceDocs.getByRole("status")).not.toHaveText("Saved");
            await chatsToggle.click();
            await openSpaceDocs(alice, alicePage, ALICE_CHAT, false);
            await expect(aliceEditor).toContainText("Unsent change survives navigation and retry.");
            await alicePage.unroute("**/send/m.room.encrypted/**", rejectSend);
            await aliceDocs.getByRole("button", { name: "Retry", exact: true }).click();
            await expect(bobEditor).toContainText("Unsent change survives navigation and retry.");
            await expect(aliceDocs.getByRole("status")).toHaveText("Saved");
            await expect(aliceEditor).toBeEditable();
            await expect.poll(async () => (await aliceEditor.innerText()) === (await bobEditor.innerText())).toBe(true);
            await alicePage.reload();
            await expect(alicePage).toHaveURL((url) => decodeURIComponent(url.hash) === `#/room/${spaceId}?view=docs`);
            await expect(docsToggle).toHaveAttribute("aria-current", "page");
            await expect(aliceEditor).toContainText("Unsent change survives navigation and retry.");

            const persisted = await alice.client.evaluate(
                async (client, args) => {
                    const space = client.getRoom(args.spaceId)!;
                    const anchor = space.currentState.getStateEvents(args.createType, "")!.getId()!;
                    const wire = await client.fetchRelations(args.spaceId, anchor, "m.reference", null, { limit: 100 });
                    const decoded = [];
                    for (const raw of wire.chunk) {
                        const event = client.getEventMapper()({ ...raw, room_id: args.spaceId });
                        await client.decryptEventIfNeeded(event);
                        decoded.push({
                            type: event.getType(),
                            doc: event.getContent().doc,
                            kind: event.getContent().kind,
                        });
                    }
                    return {
                        anchor,
                        wire,
                        decoded,
                        documentStateTypes: [...space.currentState.events.keys()].filter((type) =>
                            type.startsWith("com.matchahoneylatte.docs"),
                        ),
                    };
                },
                { spaceId, createType: "m.room.create" as EventType.RoomCreate },
            );
            expect(persisted.anchor).toMatch(/^\$/);
            expect(persisted.wire.chunk.length).toBeGreaterThanOrEqual(3);
            expect(persisted.wire.chunk.every((event) => event.type === "m.room.encrypted")).toBe(true);
            expect(new Set(persisted.wire.chunk.map((event) => event.sender))).toEqual(
                new Set([aliceCredentials.userId, bobCredentials.userId]),
            );
            expect(
                persisted.decoded.every(
                    (event) =>
                        event.type === DOC_EVENT &&
                        event.doc === "main" &&
                        ["update", "chunk", "commit"].includes(event.kind),
                ),
            ).toBe(true);
            expect(persisted.documentStateTypes).toEqual([]);
            for (const text of [
                "Shared plan",
                "Alice contribution",
                "Bob contribution",
                "Unsent change survives",
                "Legacy private plan",
            ])
                expect(JSON.stringify(persisted.wire)).not.toContain(text);

            // Space edits never create documents in either child chat; the original private revision remains untouched.
            const privateFrames = await alice.client.evaluate(async (client, id) => {
                const room = client.getRoom(id)!;
                const anchor = room.currentState.getStateEvents("m.room.create" as EventType.RoomCreate, "")!.getId()!;
                return (await client.fetchRelations(id, anchor, "m.reference", null, { limit: 100 })).chunk.map(
                    (event) => ({ id: event.event_id, type: event.type }),
                );
            }, aliceChatId);
            expect(privateFrames).toEqual([{ id: legacyEventId, type: "m.room.encrypted" }]);
            const emptyChild = await bob.client.evaluate(async (client, id) => {
                const anchor = client
                    .getRoom(id)!
                    .currentState.getStateEvents("m.room.create" as EventType.RoomCreate, "")!
                    .getId()!;
                return (await client.fetchRelations(id, anchor, "m.reference", null, { limit: 100 })).chunk;
            }, bobChatId);
            expect(emptyChild).toEqual([]);
            await expect(
                bob.client.evaluate(async (client, args) => client.fetchRoomEvent(args.roomId, args.eventId), {
                    roomId: aliceChatId,
                    eventId: legacyEventId,
                }),
            ).rejects.toThrow();

            await alice.viewRoomByName(ALICE_CHAT);
            await expect(chatsToggle).toHaveAttribute("aria-current", "page");
            await alicePage.getByRole("button", { name: "More", exact: true }).click();
            await alicePage.getByRole("menuitem", { name: "Earlier chat document", exact: true }).click();
            await expect(aliceDocs.getByRole("heading", { name: "Legacy private plan", exact: true })).toBeVisible();
            await expect(aliceDocs.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
            const downloadPromise = alicePage.waitForEvent("download");
            await aliceDocs.getByRole("button", { name: "Download Markdown", exact: true }).click();
            const download = await downloadPromise;
            expect(await readFile((await download.path())!, "utf8")).toBe(legacyMarkdown);
            const afterExport = await alice.client.evaluate(async (client, id) => {
                const anchor = client
                    .getRoom(id)!
                    .currentState.getStateEvents("m.room.create" as EventType.RoomCreate, "")!
                    .getId()!;
                return (await client.fetchRelations(id, anchor, "m.reference", null, { limit: 100 })).chunk.map(
                    (event) => event.event_id,
                );
            }, aliceChatId);
            expect(afterExport).toEqual([legacyEventId]);
            const spaces = alicePage.getByRole("tree", { name: "Spaces" });
            await spaces.getByRole("button", { name: "Home", exact: true }).click();
            await expect(alicePage).toHaveURL((url) => url.hash === "#/home");
            await expect(spaceNavigation).toHaveCount(0);
            await spaces.getByRole("button", { name: "Personal", exact: true }).click();
            await expect(alicePage).toHaveURL((url) => url.hash === "#/personal");
            await expect(spaceNavigation).toHaveCount(0);
            await openSpaceDocs(alice, alicePage, ALICE_CHAT);
            await expect(aliceEditor).not.toContainText("Legacy private plan");
            await expect(aliceEditor).toContainText("Unsent change survives navigation and retry.");
        } finally {
            await bob.cleanup();
            await bobPage.context().close();
        }
    });
});
