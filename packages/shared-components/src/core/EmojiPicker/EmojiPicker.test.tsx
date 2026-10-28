/*
 * Copyright 2026 Element Creations Ltd.
 * Copyright 2023 The Matrix.org Foundation C.I.C.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import { DATA_BY_CATEGORY } from "@matrix-org/emojibase-bindings";
import userEvent from "@testing-library/user-event";
import { render, waitFor, screen } from "@test-utils";
import { describe, expect, it, vi } from "vitest";

import { EmojiPicker, filterEmojis, type PickerCustomEmojiCategory } from "./EmojiPicker";

describe("EmojiPicker", function () {
    // Recent emojis as they would be provided by the app, most used first
    const RECENT_EMOJIS = ["😀", "🎉", "❤️"];

    // Helper to get the currently active emoji's text content from the grid
    const getActiveEmojiText = (container: HTMLElement): string =>
        container.querySelector('[role="gridcell"] [tabindex="0"]')?.textContent || "";

    it("should disable the recent category when no recent emojis", () => {
        render(<EmojiPicker onChoose={() => false} onFinished={vi.fn()} />);

        const recentTab = screen.getByRole("tab", { name: "🕒" });
        expect(recentTab).toBeDisabled();
    });

    it("should select the people category by default when no recent emojis", () => {
        render(<EmojiPicker onChoose={() => false} onFinished={vi.fn()} />);

        const peopleTab = screen.getByRole("tab", { name: "😀" });
        expect(peopleTab).toHaveAttribute("aria-selected", "true");
    });

    it("should enable and select the recent category when recent emojis are supplied", () => {
        render(<EmojiPicker onChoose={() => false} onFinished={vi.fn()} recentEmojis={RECENT_EMOJIS} />);

        const recentTab = screen.getByRole("tab", { name: "🕒" });
        expect(recentTab).toBeEnabled();
        expect(recentTab).toHaveAttribute("aria-selected", "true");
    });

    it("should record recent emoji when onChoose does not return false", async () => {
        const onChoose = vi.fn(() => true);
        const onRecordRecent = vi.fn();
        const { container } = render(
            <EmojiPicker onChoose={onChoose} onFinished={vi.fn()} onRecordRecent={onRecordRecent} />,
        );

        await waitFor(() => {
            expect(container.querySelector('[role="gridcell"]')).toBeInTheDocument();
        });

        await userEvent.click(container.querySelector('[role="gridcell"] [role="button"]')!);
        expect(onChoose).toHaveBeenCalledWith("😀");
        expect(onRecordRecent).toHaveBeenCalledWith("😀");
    });

    it("should not record recent emoji when onChoose returns false", async () => {
        const onRecordRecent = vi.fn();
        const { container } = render(
            <EmojiPicker onChoose={() => false} onFinished={vi.fn()} onRecordRecent={onRecordRecent} />,
        );

        await waitFor(() => {
            expect(container.querySelector('[role="gridcell"]')).toBeInTheDocument();
        });

        await userEvent.click(container.querySelector('[role="gridcell"] [role="button"]')!);
        expect(onRecordRecent).not.toHaveBeenCalled();
    });

    it("should not mangle default order after filtering", async () => {
        const { container } = render(<EmojiPicker onChoose={() => false} onFinished={vi.fn()} />);

        // Extract the list of emoji currently visible in the grid
        const getVisibleEmojis = (): string[] =>
            Array.from(container.querySelectorAll('[role="gridcell"]')).map((cell) => cell.textContent || "");

        await waitFor(() => {
            expect(container.querySelector('[role="gridcell"]')).toBeInTheDocument();
        });

        // Wait for the virtualized rows to settle (out-of-view categories drop
        // their transient initial rows once measured) before capturing.
        const beforeEmojis = getVisibleEmojis();

        const input = container.querySelector("input")!;

        // Apply a filter and assert that the visible emoji have changed
        await userEvent.type(input, "test");
        await waitFor(() => expect(getVisibleEmojis()).not.toEqual(beforeEmojis));

        // There may be different numbers of emoji before after since virtuoso may
        // end up rendering more or fewer off screen. Chop any excess off so that it's
        // just the *order* we're comparing.
        await userEvent.clear(input);
        await waitFor(() => {
            const afterEmojis = getVisibleEmojis();
            const length = Math.min(beforeEmojis.length, afterEmojis.length);
            expect(afterEmojis.slice(0, length)).toEqual(beforeEmojis.slice(0, length));
        });
    });

    it("should keep the filter applied when recentEmojis prop is changed", async () => {
        const { container, rerender } = render(
            <EmojiPicker onChoose={() => false} onFinished={vi.fn()} recentEmojis={[...RECENT_EMOJIS]} />,
        );

        const getVisibleEmojis = (): string[] =>
            Array.from(container.querySelectorAll('[role="gridcell"]')).map((cell) => cell.textContent || "");

        const input = container.querySelector("input")!;
        await userEvent.type(input, "wave");
        await waitFor(() => expect(getVisibleEmojis()).toContain("👋"));
        const filtered = getVisibleEmojis();

        // add another recently used emoji but it doesn't match the filter, so it should not change what's visible.
        rerender(<EmojiPicker onChoose={() => false} onFinished={vi.fn()} recentEmojis={["🦡", ...RECENT_EMOJIS]} />);

        expect(input).toHaveValue("wave");
        expect(getVisibleEmojis()).toEqual(filtered);
    });

    it("sort emojis by shortcode and size", function () {
        const sorted = filterEmojis(DATA_BY_CATEGORY.people, "heart");

        expect(sorted[0].shortcodes[0]).toEqual("heart");
        expect(sorted[1].shortcodes[0]).toEqual("heartbeat");
    });

    it("should allow keyboard navigation using arrow keys", async () => {
        const onChoose = vi.fn();
        const onFinished = vi.fn();
        const { container } = render(<EmojiPicker onChoose={onChoose} onFinished={onFinished} />);

        const input = container.querySelector("input")!;
        await waitFor(() => expect(input).toHaveFocus());

        function getEmoji(): string {
            return getActiveEmojiText(container);
        }

        await waitFor(() => expect(getEmoji()).toEqual("😀"));
        // First arrow key press shows highlight without navigating
        await userEvent.keyboard("[ArrowDown]");
        expect(getEmoji()).toEqual("😀");
        // Subsequent arrow keys navigate
        await userEvent.keyboard("[ArrowDown]");
        expect(getEmoji()).toEqual("🙂");
        await userEvent.keyboard("[ArrowUp]");
        expect(getEmoji()).toEqual("😀");
        await userEvent.keyboard("Flag");
        await waitFor(() => expect(getEmoji()).not.toEqual("😀"));
        await userEvent.keyboard("[ArrowRight]");
        await userEvent.keyboard("[ArrowRight]");
        expect(getEmoji()).toEqual("📫️");
        await userEvent.keyboard("[ArrowDown]");
        expect(getEmoji()).toEqual("🇦🇨");
        await userEvent.keyboard("[ArrowLeft]");
        expect(getEmoji()).toEqual("📭️");
        await userEvent.keyboard("[ArrowUp]");
        expect(getEmoji()).toEqual("⛳️");
        await userEvent.keyboard("[ArrowRight]");
        expect(getEmoji()).toEqual("📫️");
        await userEvent.keyboard("[Enter]");

        expect(onChoose).toHaveBeenCalledWith("📫️");
        expect(onFinished).toHaveBeenCalled();
    });

    it("should move actual focus when navigating between emojis after Tab", async () => {
        const onChoose = vi.fn();
        const onFinished = vi.fn();
        const { container } = render(<EmojiPicker onChoose={onChoose} onFinished={onFinished} />);

        const input = container.querySelector("input")!;
        await waitFor(() => expect(input).toHaveFocus());

        // Wait for emojis to render
        await waitFor(() => {
            expect(container.querySelector('[role="gridcell"]')).toBeInTheDocument();
        });

        function getEmoji(): string {
            return document.activeElement?.textContent || "";
        }

        function getVirtuallyFocusedEmoji(): string {
            return getActiveEmojiText(container);
        }

        // Initially, arrow keys use virtual focus (aria-activedescendant)
        // The first emoji is virtually focused by default
        expect(input).toHaveFocus();
        expect(getVirtuallyFocusedEmoji()).toEqual("😀");
        expect(getEmoji()).toEqual(""); // No actual emoji has focus

        // First arrow key press shows highlight without navigating
        await userEvent.keyboard("[ArrowDown]");
        expect(input).toHaveFocus(); // Input still has focus
        expect(getVirtuallyFocusedEmoji()).toEqual("😀"); // Virtual focus stayed on first emoji
        expect(getEmoji()).toEqual(""); // No actual emoji has focus

        // Second arrow key press navigates
        await userEvent.keyboard("[ArrowDown]");
        expect(input).toHaveFocus(); // Input still has focus
        expect(getVirtuallyFocusedEmoji()).toEqual("🙂"); // Virtual focus moved
        expect(getEmoji()).toEqual(""); // No actual emoji has focus

        // Tab to move actual focus to the emoji
        await userEvent.keyboard("[Tab]");
        expect(input).not.toHaveFocus();
        expect(getEmoji()).toEqual("🙂"); // Now emoji has actual focus

        // Arrow keys now move actual DOM focus between emojis
        await userEvent.keyboard("[ArrowDown]");
        expect(getEmoji()).toEqual("🤩"); // Actual focus moved down one row
        expect(input).not.toHaveFocus();

        await userEvent.keyboard("[ArrowUp]");
        expect(getEmoji()).toEqual("🙂"); // Actual focus moved back up
        expect(input).not.toHaveFocus();

        await userEvent.keyboard("[ArrowRight]");
        expect(getEmoji()).toEqual("🙃"); // Actual focus moved right
        expect(input).not.toHaveFocus();
    });

    it("should not select emoji on Enter press before highlight is shown", async () => {
        const onChoose = vi.fn();
        const onFinished = vi.fn();
        const { container } = render(<EmojiPicker onChoose={onChoose} onFinished={onFinished} />);

        const input = container.querySelector("input")!;
        await waitFor(() => expect(input).toHaveFocus());

        // Wait for emojis to render
        await waitFor(() => {
            expect(container.querySelector('[role="gridcell"]')).toBeInTheDocument();
        });

        // Press Enter immediately without interacting with arrow keys or search
        await userEvent.keyboard("[Enter]");

        // onChoose and onFinished should not be called
        expect(onChoose).not.toHaveBeenCalled();
        expect(onFinished).not.toHaveBeenCalled();

        // Now press arrow key to show highlight
        await userEvent.keyboard("[ArrowDown]");

        // Press Enter again - now it should work
        await userEvent.keyboard("[Enter]");

        // onChoose and onFinished should be called
        expect(onChoose).toHaveBeenCalledWith("😀");
        expect(onFinished).toHaveBeenCalled();
    });

    it("should reset to first emoji when filter is cleared after navigation", async () => {
        const onChoose = vi.fn();
        const onFinished = vi.fn();
        const { container } = render(<EmojiPicker onChoose={onChoose} onFinished={onFinished} />);

        const input = container.querySelector("input")!;
        await waitFor(() => expect(input).toHaveFocus());

        function getEmoji(): string {
            return getActiveEmojiText(container);
        }

        // Initially on first emoji
        await waitFor(() => expect(getEmoji()).toEqual("😀"));

        // Show highlight with first arrow press
        await userEvent.keyboard("[ArrowDown]");
        expect(getEmoji()).toEqual("😀");

        // Navigate to a different emoji
        await userEvent.keyboard("[ArrowDown]");
        expect(getEmoji()).toEqual("🙂");
        await userEvent.keyboard("[ArrowDown]");
        expect(getEmoji()).toEqual("🤩");

        // Type a search query to filter emojis (this sets showHighlight=true)
        await userEvent.type(input, "think");
        await waitFor(() => {
            // After filtering, we should be on the "thinking" emoji
            expect(getEmoji()).toEqual("🤔");
        });

        // Clear the search filter
        await userEvent.clear(input);

        // After clearing, showHighlight is false, so the highlight is hidden
        // The activeNode might still be on 🤔, but we can't see it

        // Press arrow key - this should reset to first emoji AND show highlight
        await userEvent.keyboard("[ArrowDown]");
        await waitFor(() => {
            expect(getEmoji()).toEqual("😀"); // Should now be on first emoji with highlight shown
        });

        // Next arrow key should navigate from first emoji
        await userEvent.keyboard("[ArrowDown]");
        expect(getEmoji()).toEqual("🙂");
    });

    it("should point aria-activedescendant at the active emoji while searching", async () => {
        const { container } = render(<EmojiPicker onChoose={vi.fn()} onFinished={vi.fn()} />);

        const input = container.querySelector("input")!;
        await waitFor(() => expect(input).toHaveFocus());

        function getActiveEmoji(): HTMLElement {
            return container.querySelector<HTMLElement>('[role="gridcell"] [tabindex="0"]')!;
        }

        // With no query, the input must not claim an active descendant: doing so makes
        // screen readers read out the first emoji merely on focusing the input.
        await waitFor(() => expect(getActiveEmoji()).toBeInTheDocument());
        expect(input).not.toHaveAttribute("aria-activedescendant");

        // Once there's a query, the active emoji must be identified to screen readers,
        // which requires the emoji cells to have IDs for aria-activedescendant to target.
        await userEvent.type(input, "te");
        await waitFor(() => expect(getActiveEmoji().textContent).toEqual("🧑‍🏫"));

        const activeId = getActiveEmoji().id;
        expect(activeId).not.toEqual("");
        expect(input).toHaveAttribute("aria-activedescendant", activeId);
        expect(container.querySelectorAll(`[id="${activeId}"]`)).toHaveLength(1);

        // ...and it must follow the selection as the query changes
        await userEvent.type(input, "s");
        await waitFor(() => expect(getActiveEmoji().textContent).toEqual("🧪"));
        expect(input).toHaveAttribute("aria-activedescendant", getActiveEmoji().id);
        expect(getActiveEmoji().id).not.toEqual(activeId);
    });

    describe("Category keyboard selection", () => {
        it("check tabindex for the first category when no recent emojis", async () => {
            const { container } = render(<EmojiPicker onChoose={vi.fn()} onFinished={vi.fn()} />);

            await waitFor(() => {
                expect(container.querySelector('[data-category-id="people"]')).toBeInTheDocument();
            });

            // People category should have tabindex="0"
            const peopleTab = container.querySelector('[title*="Smileys"]');
            expect(peopleTab).toHaveAttribute("tabindex", "0");
            expect(peopleTab).toHaveAttribute("aria-selected", "true");

            // Other categories should have tabindex="-1"
            const natureTab = container.querySelector('[title*="Animals"]');
            expect(natureTab).toHaveAttribute("tabindex", "-1");
        });

        it("check tabindex for recent category when recent emojis exist", async () => {
            const { container } = render(
                <EmojiPicker recentEmojis={RECENT_EMOJIS.slice(0, 2)} onChoose={vi.fn()} onFinished={vi.fn()} />,
            );

            await waitFor(() => {
                expect(container.querySelector('[data-category-id="recent"]')).toBeInTheDocument();
            });

            // Recent category should have tabindex="0"
            const recentTab = container.querySelector('[title*="Frequently"]');
            expect(recentTab).toHaveAttribute("tabindex", "0");
            expect(recentTab).toHaveAttribute("aria-selected", "true");

            // People category should have tabindex="-1"
            const peopleTab = container.querySelector('[title*="Smileys"]');
            expect(peopleTab).toHaveAttribute("tabindex", "-1");
        });

        it("should update table position when clicking on a different category tab", async () => {
            const { container } = render(<EmojiPicker onChoose={vi.fn()} onFinished={vi.fn()} />);

            await waitFor(() => {
                expect(container.querySelector('[data-category-id="people"]')).toBeInTheDocument();
            });

            // Initially, people category should be visible
            const peopleTab = container.querySelector('[title*="Smileys"]')!;
            expect(peopleTab).toHaveAttribute("tabindex", "0");

            // Click on nature category tab
            const natureTab = container.querySelector('[title*="Animals"]')!;
            await userEvent.click(natureTab);

            // Wait for scroll and visibility update
            await waitFor(() => {
                const natureCategory = container.querySelector('[data-category-id="nature"]');
                expect(natureCategory).toBeInTheDocument();
            });
        });

        it("should navigate between category tabs using arrow keys", async () => {
            const { container } = render(<EmojiPicker onChoose={vi.fn()} onFinished={vi.fn()} />);

            await waitFor(() => {
                expect(container.querySelector('[data-category-id="people"]')).toBeInTheDocument();
            });

            // Focus on the category header
            const peopleTab = container.querySelector<HTMLButtonElement>('[title*="Smileys"]')!;
            peopleTab.focus();
            expect(peopleTab).toHaveFocus();

            // Press ArrowRight to move to next category
            await userEvent.keyboard("[ArrowRight]");

            // Should focus on next enabled category and trigger scroll
            await waitFor(() => {
                // Verify focus moved away from people tab
                expect(peopleTab).not.toHaveFocus();

                // Verify some other category tab now has focus
                const focusedTab = document.activeElement;
                expect(focusedTab?.getAttribute("role")).toBe("tab");
                expect(focusedTab).not.toBe(peopleTab);
            });
        });

        it("should navigate to first/last category using Home/End keys", async () => {
            const { container } = render(<EmojiPicker onChoose={vi.fn()} onFinished={vi.fn()} />);

            await waitFor(() => {
                expect(container.querySelector('[data-category-id="people"]')).toBeInTheDocument();
            });

            // Focus on the category header
            const peopleTab = container.querySelector<HTMLButtonElement>('[title*="Smileys"]')!;
            peopleTab.focus();

            // Press End to jump to last category
            await userEvent.keyboard("[End]");

            await waitFor(() => {
                const flagsTab = container.querySelector('[title*="Flags"]')!;
                expect(flagsTab).toHaveFocus();
            });

            // Press Home to jump to first category
            await userEvent.keyboard("[Home]");

            await waitFor(() => {
                expect(peopleTab).toHaveFocus();
            });
        });
    });

    describe("Custom emoji", () => {
        const image = (fill: string): string =>
            `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2" fill="${fill}"/></svg>`)}`;
        const BLOB = { key: "mxc://example.org/blob", shortcode: "blob_cat", src: image("orange") };
        const PARROT = { key: "mxc://example.org/parrot", shortcode: "party_parrot", src: image("green") };
        const CATEGORIES: PickerCustomEmojiCategory[] = [{ id: "pack", name: "Cat Server", emojis: [BLOB, PARROT] }];

        // The active emoji's text, or the alt text of a custom emoji's image
        const getActiveEmojiName = (container: HTMLElement): string => {
            const node = container.querySelector('[role="gridcell"] [tabindex="0"]');
            return node?.querySelector("img")?.alt ?? node?.textContent ?? "";
        };

        it("should show a tab and a section for a custom category after the recent one", async () => {
            render(<EmojiPicker onChoose={vi.fn()} onFinished={vi.fn()} customEmojiCategories={CATEGORIES} />);

            const tab = screen.getByRole("tab", { name: "Cat Server" });
            expect(screen.getAllByRole("tab").map((t) => t.getAttribute("title"))).toEqual([
                "Frequently Used",
                "Cat Server",
                "Smileys & People",
                "Animals & Nature",
                "Food & Drink",
                "Activities",
                "Travel & Places",
                "Objects",
                "Symbols",
                "Flags",
            ]);
            // Selected, as there are no recent emoji, and showing the first emoji's image
            expect(tab).toHaveAttribute("aria-selected", "true");
            expect(tab.querySelector("img")).toHaveAttribute("src", BLOB.src);

            expect(await screen.findByRole("heading", { name: "Cat Server" })).toBeInTheDocument();
            const img = screen.getByRole("img", { name: ":blob_cat:" });
            expect(img).toHaveAttribute("src", BLOB.src);
            expect(img).toHaveAttribute("loading", "lazy");
            expect(img).toHaveAttribute("draggable", "false");
            expect(screen.getByRole("button", { name: ":party_parrot:" })).toBeInTheDocument();
        });

        it("should prefer the category's icon for its tab", () => {
            render(
                <EmojiPicker
                    onChoose={vi.fn()}
                    onFinished={vi.fn()}
                    customEmojiCategories={[{ ...CATEGORIES[0], iconSrc: PARROT.src }]}
                />,
            );

            expect(screen.getByRole("tab", { name: "Cat Server" }).querySelector("img")).toHaveAttribute(
                "src",
                PARROT.src,
            );
        });

        it("should keep the recent category selected when there are recent emoji", () => {
            render(
                <EmojiPicker
                    onChoose={vi.fn()}
                    onFinished={vi.fn()}
                    recentEmojis={RECENT_EMOJIS}
                    customEmojiCategories={CATEGORIES}
                />,
            );

            expect(screen.getByRole("tab", { name: "🕒" })).toHaveAttribute("aria-selected", "true");
            expect(screen.getByRole("tab", { name: "Cat Server" })).toHaveAttribute("aria-selected", "false");
        });

        it("should pass the custom emoji to onChoose and not record it as recent", async () => {
            const onChoose = vi.fn(() => true);
            const onRecordRecent = vi.fn();
            render(
                <EmojiPicker
                    onChoose={onChoose}
                    onFinished={vi.fn()}
                    onRecordRecent={onRecordRecent}
                    customEmojiCategories={CATEGORIES}
                />,
            );

            await userEvent.click(await screen.findByRole("button", { name: ":party_parrot:" }));
            expect(onChoose).toHaveBeenCalledWith(PARROT.key, PARROT);
            expect(onRecordRecent).not.toHaveBeenCalled();
        });

        it("should find custom emoji by shortcode", async () => {
            const { container } = render(
                <EmojiPicker onChoose={vi.fn()} onFinished={vi.fn()} customEmojiCategories={CATEGORIES} />,
            );

            await userEvent.type(container.querySelector("input")!, "PARROT");
            // Together, as the list may be briefly empty while it re-renders
            await waitFor(() => {
                expect(screen.getByRole("button", { name: ":party_parrot:" })).toBeInTheDocument();
                expect(screen.queryByRole("button", { name: ":blob_cat:" })).not.toBeInTheDocument();
                expect(getActiveEmojiName(container)).toEqual(":party_parrot:");
            });
            expect(screen.getByRole("tab", { name: "Cat Server" })).toBeEnabled();
            expect(screen.getByRole("tab", { name: "😀" })).toBeDisabled();
        });

        it("should match custom emoji by key in selectedEmojis and isEmojiDisabled", async () => {
            render(
                <EmojiPicker
                    onChoose={vi.fn()}
                    onFinished={vi.fn()}
                    customEmojiCategories={CATEGORIES}
                    selectedEmojis={new Set([BLOB.key])}
                    isEmojiDisabled={(unicode) => unicode === PARROT.key}
                />,
            );

            expect(await screen.findByRole("checkbox", { name: ":blob_cat:" })).toHaveAttribute("aria-checked", "true");
            const parrot = screen.getByRole("checkbox", { name: ":party_parrot:" });
            expect(parrot).toHaveAttribute("aria-checked", "false");
            expect(parrot).toHaveAttribute("aria-disabled", "true");
        });

        it("should reach custom emoji with keyboard navigation", async () => {
            const onChoose = vi.fn();
            const onFinished = vi.fn();
            const { container } = render(
                <EmojiPicker onChoose={onChoose} onFinished={onFinished} customEmojiCategories={CATEGORIES} />,
            );

            await waitFor(() => expect(container.querySelector("input")).toHaveFocus());
            await waitFor(() => expect(getActiveEmojiName(container)).toEqual(":blob_cat:"));
            // First arrow key press shows the highlight without navigating
            await userEvent.keyboard("[ArrowDown]");
            expect(getActiveEmojiName(container)).toEqual(":blob_cat:");
            await userEvent.keyboard("[ArrowRight]");
            expect(getActiveEmojiName(container)).toEqual(":party_parrot:");
            // Down into the built-in emoji, and back up
            await userEvent.keyboard("[ArrowDown]");
            expect(getActiveEmojiName(container)).not.toMatch(/^:/);
            await userEvent.keyboard("[ArrowUp]");
            expect(getActiveEmojiName(container)).toEqual(":party_parrot:");
            await userEvent.keyboard("[Enter]");

            expect(onChoose).toHaveBeenCalledWith(PARROT.key, PARROT);
            expect(onFinished).toHaveBeenCalled();
        });

        it("should show the shortcode of a hovered custom emoji in the preview", async () => {
            const { container } = render(
                <EmojiPicker onChoose={vi.fn()} onFinished={vi.fn()} customEmojiCategories={CATEGORIES} />,
            );

            await userEvent.hover(await screen.findByRole("button", { name: ":blob_cat:" }));
            const preview = container.querySelector("section > div:last-child")!;
            expect(preview.textContent).toEqual(":blob_cat:");
            expect(preview.querySelector("img")).toHaveAttribute("src", BLOB.src);
        });

        it("should rank a custom emoji whatever the case of its shortcode", async () => {
            const POG = { key: "mxc://example.org/pog", shortcode: "Pog", src: image("red") };
            const POGGER = { key: "mxc://example.org/pogger", shortcode: "pogger", src: image("blue") };
            const { container } = render(
                <EmojiPicker
                    onChoose={vi.fn()}
                    onFinished={vi.fn()}
                    customEmojiCategories={[{ id: "pack", name: "Pog", emojis: [POGGER, POG] }]}
                />,
            );

            await userEvent.type(container.querySelector("input")!, "pog");
            // The exact, shorter match first, as for built-in emoji
            await waitFor(() => expect(getActiveEmojiName(container)).toEqual(":Pog:"));
        });

        it("should wrap a long custom shortcode in the preview", async () => {
            const LONG = { key: "mxc://example.org/long", shortcode: "w".repeat(40), src: image("blue") };
            const { container } = render(
                <EmojiPicker
                    onChoose={vi.fn()}
                    onFinished={vi.fn()}
                    customEmojiCategories={[{ id: "pack", name: "Long", emojis: [LONG] }]}
                />,
            );

            await userEvent.hover(await screen.findByRole("button", { name: `:${LONG.shortcode}:` }));
            const name = [...container.querySelectorAll("section > div:last-child div")].find(
                (div) => div.textContent === `:${LONG.shortcode}:` && !div.children.length,
            )!;
            expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth);
        });

        it("should keep the selected tab in view as the grid scrolls", async () => {
            const { container } = render(
                <EmojiPicker
                    onChoose={vi.fn()}
                    onFinished={vi.fn()}
                    customEmojiCategories={[CATEGORIES[0], { ...CATEGORIES[0], id: "pack2", name: "Second" }]}
                />,
            );
            const tablist = screen.getByRole("tablist");
            const flags = screen.getByRole("tab", { name: "🏁" });
            // Off the end of the bar to start with
            expect(flags.getBoundingClientRect().right).toBeGreaterThan(tablist.getBoundingClientRect().right);

            const body = container.querySelector<HTMLElement>(`#${CSS.escape(flags.getAttribute("aria-controls")!)}`)!;
            await waitFor(() => {
                body.scrollTop = body.scrollHeight;
                expect(flags).toHaveAttribute("aria-selected", "true");
            });
            await waitFor(() =>
                expect(flags.getBoundingClientRect().right).toBeLessThanOrEqual(tablist.getBoundingClientRect().right),
            );
        });

        it("should navigate to custom category tabs added after mount", async () => {
            const { container, rerender } = render(<EmojiPicker onChoose={vi.fn()} onFinished={vi.fn()} />);
            rerender(<EmojiPicker onChoose={vi.fn()} onFinished={vi.fn()} customEmojiCategories={CATEGORIES} />);

            await waitFor(() => {
                expect(container.querySelector('[data-category-id="custom:pack"]')).toBeInTheDocument();
            });
            // Now at the top of the list, so selected
            const customTab = screen.getByRole("tab", { name: "Cat Server" });
            await waitFor(() => expect(customTab).toHaveAttribute("aria-selected", "true"));

            customTab.focus();
            await userEvent.keyboard("[End]");
            await waitFor(() => expect(screen.getByRole("tab", { name: "🏁" })).toHaveFocus());
            // The first tab (recent) is disabled, so Home lands on the custom one
            await userEvent.keyboard("[Home]");
            await waitFor(() => expect(customTab).toHaveFocus());
        });

        it("should scroll extra tabs rather than wrap them", () => {
            const { unmount } = render(<EmojiPicker onChoose={vi.fn()} onFinished={vi.fn()} />);
            const builtInOnly = screen.getByRole("tablist");
            // The built-in tabs fill the width exactly
            expect(builtInOnly.scrollWidth).toEqual(builtInOnly.clientWidth);
            const height = builtInOnly.clientHeight;
            unmount();

            render(<EmojiPicker onChoose={vi.fn()} onFinished={vi.fn()} customEmojiCategories={CATEGORIES} />);
            const tablist = screen.getByRole("tablist");
            // No taller, excluding any scrollbar: the image tabs must not push the row down
            expect(tablist.clientHeight).toBeLessThanOrEqual(height);
            expect(tablist.scrollWidth).toBeGreaterThan(tablist.clientWidth);
            // All on one line
            for (const tab of screen.getAllByRole("tab")) expect(tab.offsetTop).toBeLessThan(tab.offsetHeight);
        });
    });
});
