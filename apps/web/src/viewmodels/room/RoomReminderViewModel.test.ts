/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { RoomReminderViewModel, isValidReminderDraft } from "./RoomReminderViewModel";

describe("RoomReminderViewModel", () => {
    const now = new Date(2026, 9, 23, 9, 0, 0).getTime();

    it.each([
        ["s", 1000],
        ["m", 60_000],
        ["h", 3_600_000],
        ["d", 86_400_000],
    ] as const)("converts whole %s to an exact requested timestamp", (unit, milliseconds) => {
        const onFinished = vi.fn();
        const vm = new RoomReminderViewModel({ now: () => now, onFinished });
        vm.setMessage("  Check the release  ");
        vm.setDuration("2");
        vm.setUnit(unit);
        expect(vm.getSnapshot().canSubmit).toBe(true);
        vm.submit();
        vm.submit();
        expect(onFinished).toHaveBeenCalledExactlyOnceWith(true, {
            at: now + 2 * milliseconds,
            message: "Check the release",
            delaySeconds: (2 * milliseconds) / 1000,
        });
        vm.dispose();
    });

    it("prefills a precise local time and preserves the separate message", () => {
        const onFinished = vi.fn();
        const at = now + 90_000;
        const vm = new RoomReminderViewModel({ now: () => now, onFinished, initial: { at, message: "Ship" } });
        expect(vm.getSnapshot()).toMatchObject({
            mode: "at",
            dateTime: "2026-10-23T09:01:30",
            message: "Ship",
            canSubmit: true,
        });
        vm.submit();
        expect(onFinished).toHaveBeenCalledWith(true, { at, message: "Ship" });
        vm.dispose();
    });

    it("rejects invalid dates, past times, excessive durations and messages", () => {
        const onFinished = vi.fn();
        const vm = new RoomReminderViewModel({ now: () => now, onFinished, initial: { message: "Check" } });
        vm.setMode("at");
        for (const dateTime of ["2026-02-30T12:00", "2026-10-23T08:59", "2026-10-23T25:00", "tomorrow"]) {
            vm.setDateTime(dateTime);
            vm.submit();
            expect(vm.getSnapshot().canSubmit).toBe(false);
        }
        vm.setMode("in");
        vm.setUnit("d");
        for (const duration of ["0", "-1", "1.5", "366", "1e3"]) {
            vm.setDuration(duration);
            expect(vm.getSnapshot().canSubmit).toBe(false);
        }
        vm.setDuration("1");
        vm.setMessage("x".repeat(2001));
        vm.submit();
        expect(onFinished).not.toHaveBeenCalled();
        vm.dispose();
    });

    it("rechecks elapsed time on submission and treats cancellation as final", () => {
        let clock = now;
        const onFinished = vi.fn();
        const vm = new RoomReminderViewModel({
            now: () => clock,
            onFinished,
            initial: { at: now + 1000, message: "Soon" },
        });
        clock += 2000;
        vm.submit();
        expect(onFinished).not.toHaveBeenCalled();
        expect(vm.getSnapshot().error).toBeTruthy();
        vm.cancel();
        vm.setMode("in");
        vm.submit();
        expect(onFinished).toHaveBeenCalledExactlyOnceWith(false);
        vm.dispose();
    });

    it("validates the final request independently of form state", () => {
        expect(isValidReminderDraft({ at: now + 1000, message: "Hi" }, now)).toBe(true);
        expect(isValidReminderDraft({ at: now, message: "Hi" }, now)).toBe(false);
        expect(isValidReminderDraft({ at: Infinity, message: "Hi" }, now)).toBe(false);
        expect(isValidReminderDraft({ at: now + 1000, message: " " }, now)).toBe(false);
    });
});
