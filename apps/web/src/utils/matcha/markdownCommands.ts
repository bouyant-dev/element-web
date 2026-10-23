/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { EditorSelection, type ChangeSpec, type SelectionRange } from "@codemirror/state";
import { type EditorView } from "@codemirror/view";
import { type DocFormatCommand } from "@element-hq/web-shared-components";

import { _t } from "../../languageHandler";

function wrap(
    view: EditorView,
    markers: (range: SelectionRange) => [string, string],
    placeholder: string,
    toggle = true,
): void {
    const state = view.state;
    view.dispatch({
        ...state.changeByRange((range) => {
            const [before, after] = markers(range);
            const selected = state.sliceDoc(range.from, range.to);
            // A pair of asterisks is bold, not an existing italic delimiter.
            const italicInside =
                before !== "*" ||
                ((selected.match(/^\*+/)?.[0].length ?? 0) % 2 === 1 &&
                    (selected.match(/\*+$/)?.[0].length ?? 0) % 2 === 1);
            const italicOutside =
                before !== "*" ||
                ((state.sliceDoc(state.doc.lineAt(range.from).from, range.from).match(/\*+$/)?.[0].length ?? 0) % 2 ===
                    1 &&
                    (state.sliceDoc(range.to, state.doc.lineAt(range.to).to).match(/^\*+/)?.[0].length ?? 0) % 2 === 1);
            if (
                toggle &&
                italicInside &&
                selected.startsWith(before) &&
                selected.endsWith(after) &&
                selected.length >= before.length + after.length
            ) {
                return {
                    changes: [
                        { from: range.from, to: range.from + before.length },
                        { from: range.to - after.length, to: range.to },
                    ],
                    range: EditorSelection.range(range.from, range.to - before.length - after.length),
                };
            }
            if (
                toggle &&
                italicOutside &&
                range.from >= before.length &&
                state.sliceDoc(range.from - before.length, range.from) === before &&
                state.sliceDoc(range.to, range.to + after.length) === after
            ) {
                return {
                    changes: [
                        { from: range.from - before.length, to: range.from },
                        { from: range.to, to: range.to + after.length },
                    ],
                    range: EditorSelection.range(range.from - before.length, range.to - before.length),
                };
            }
            return {
                changes: range.empty
                    ? { from: range.from, insert: before + placeholder + after }
                    : [
                          { from: range.from, insert: before },
                          { from: range.to, insert: after },
                      ],
                range: EditorSelection.range(
                    range.from + before.length,
                    range.to + before.length + (range.empty ? placeholder.length : 0),
                ),
            };
        }),
        userEvent: "input.format",
        scrollIntoView: true,
    });
}

function prefixLines(view: EditorView, command: DocFormatCommand): void {
    const { state } = view;
    const lineNumbers = new Set<number>();
    for (const range of state.selection.ranges) {
        const first = state.doc.lineAt(range.from).number;
        const last = state.doc.lineAt(range.empty ? range.to : Math.max(range.from, range.to - 1)).number;
        for (let number = first; number <= last; number++) lineNumbers.add(number);
    }
    const heading = /^heading([1-3])$/.exec(command);
    const prefix = heading
        ? "#".repeat(Number(heading[1])) + " "
        : command === "quote"
          ? "> "
          : command === "taskList"
            ? "- [ ] "
            : "- ";
    const existing = heading
        ? /^#{1,6}\s+/
        : command === "quote"
          ? /^>\s?/
          : /^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/;
    const same = heading
        ? new RegExp(`^#{${heading[1]}}\\s+`)
        : command === "quote"
          ? /^>\s?/
          : command === "taskList"
            ? /^[-*+]\s+\[[ xX]\]\s+/
            : command === "orderedList"
              ? /^\d+[.)]\s+/
              : /^[-*+]\s+(?!\[[ xX]\])/;
    const lines = [...lineNumbers].sort((a, b) => a - b).map((number) => state.doc.line(number));
    const nonempty = lines.filter((line) => line.text.trim());
    const remove = nonempty.length > 0 && nonempty.every((line) => same.test(line.text.trimStart()));
    const changes: ChangeSpec[] = [];
    let number = 1;
    for (const line of lines) {
        if (!line.text.trim() && lines.length > 1) continue;
        const indent = line.text.match(/^\s*/)?.[0].length ?? 0;
        const from = line.from + indent;
        const oldPrefix = existing.exec(line.text.slice(indent))?.[0] ?? "";
        const marker = command === "orderedList" ? `${number++}. ` : prefix;
        changes.push({ from, to: from + oldPrefix.length, insert: remove ? "" : marker });
    }
    const changeSet = state.changes(changes);
    view.dispatch({
        changes: changeSet,
        selection: state.selection.map(changeSet),
        userEvent: "input.format",
        scrollIntoView: true,
    });
}

/** Apply local Markdown edits at the selection, preserving unaffected text and collaborative character identities. */
export function formatMarkdown(view: EditorView, command: Exclude<DocFormatCommand, "undo" | "redo" | "find">): void {
    if (view.state.readOnly) return;
    if (["heading1", "heading2", "heading3", "bulletList", "orderedList", "taskList", "quote"].includes(command)) {
        prefixLines(view, command);
        return;
    }
    if (command === "bold" || command === "italic" || command === "strike") {
        const marker = command === "bold" ? "**" : command === "italic" ? "*" : "~~";
        wrap(view, () => [marker, marker], _t("matcha_docs|format_text"));
        return;
    }
    const { state } = view;
    if (command === "inlineCode" || command === "codeBlock") {
        wrap(
            view,
            ({ from, to }) => {
                const longest = Math.max(0, ...(state.sliceDoc(from, to).match(/`+/g) ?? []).map((run) => run.length));
                const fence = "`".repeat(Math.max(command === "codeBlock" ? 3 : 1, longest + 1));
                return command === "codeBlock"
                    ? [
                          (from > state.doc.lineAt(from).from ? "\n" : "") + fence + "\n",
                          "\n" + fence + (to < state.doc.lineAt(to).to ? "\n" : ""),
                      ]
                    : [fence + (longest ? " " : ""), (longest ? " " : "") + fence];
            },
            _t("matcha_docs|format_code"),
            command === "inlineCode",
        );
    } else if (command === "link") {
        const label = _t("matcha_docs|format_link");
        const url = "https://";
        view.dispatch({
            ...state.changeByRange(({ from, to, empty }) => {
                const prefix = empty ? "[" + label : "[";
                return {
                    changes: empty
                        ? { from, insert: `${prefix}](${url})` }
                        : [
                              { from, insert: "[" },
                              { from: to, insert: `](${url})` },
                          ],
                    range: EditorSelection.range(to + prefix.length + 2, to + prefix.length + 2 + url.length),
                };
            }),
            userEvent: "input.format",
            scrollIntoView: true,
        });
    } else if (command === "table") {
        const column = _t("matcha_docs|format_column");
        const cell = _t("matcha_docs|format_cell");
        const table = `| ${column} 1 | ${column} 2 |\n| --- | --- |\n| ${cell} | ${cell} |\n`;
        view.dispatch({
            ...state.changeByRange(({ to }) => {
                const before =
                    to === 0 || state.sliceDoc(Math.max(0, to - 2), to).endsWith("\n\n")
                        ? ""
                        : state.doc.lineAt(to).from === to
                          ? "\n"
                          : "\n\n";
                return {
                    changes: { from: to, insert: before + table + (to < state.doc.length ? "\n" : "") },
                    range: EditorSelection.range(to + before.length + 2, to + before.length + 2 + column.length + 2),
                };
            }),
            userEvent: "input.format",
            scrollIntoView: true,
        });
    }
}
