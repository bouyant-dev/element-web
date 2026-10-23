/*
Copyright 2026 David

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/
import React, { useState } from "react";
import { type Meta, type StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { RoomDocsView, type RoomDocsSnapshot } from "./RoomDocsView";
import { useMockedViewModel } from "../../core/viewmodel";

const markdown = `# Release checklist

A shared place to keep the decisions, details, and next steps for our next release.

## Before we ship

- [x] Agree on the navigation
- [x] Review the writing experience
- [ ] Update the team handbook
- [ ] Share the release notes

> Keep each decision close to the conversation that led to it.

## Working agreements

| Topic | Agreement |
| --- | --- |
| Ownership | One person accountable per task |
| Updates | Write a short note when a decision changes |
| Follow-up | Link the discussion from the board |

## Release command

\`\`\`bash
pnpm build
pnpm start
\`\`\`

Use **bold** for key decisions, *italics* for context, and \`inline code\` for technical details.

Learn more in the [Matrix documentation](https://matrix.org/docs/).
`;

const html = `<h1>Release checklist</h1>
<p>A shared place to keep the decisions, details, and next steps for our next release.</p>
<h2>Before we ship</h2>
<ul><li>☑ Agree on the navigation</li><li>☑ Review the writing experience</li><li>☐ Update the team handbook</li><li>☐ Share the release notes</li></ul>
<blockquote><p>Keep each decision close to the conversation that led to it.</p></blockquote>
<h2>Working agreements</h2>
<table><thead><tr><th>Topic</th><th>Agreement</th></tr></thead><tbody><tr><td>Ownership</td><td>One person accountable per task</td></tr><tr><td>Updates</td><td>Write a short note when a decision changes</td></tr><tr><td>Follow-up</td><td>Link the discussion from the board</td></tr></tbody></table>
<h2>Release command</h2><pre><code>pnpm build\npnpm start</code></pre>
<p>Use <strong>bold</strong> for key decisions, <em>italics</em> for context, and <code>inline code</code> for technical details.</p>
<p>Learn more in the <a href="https://matrix.org/docs/">Matrix documentation</a>.</p>`;

function DocsWorkspace({
    initialMode = "split",
    canEdit = true,
    error,
    ready = true,
}: {
    initialMode?: RoomDocsSnapshot["mode"];
    canEdit?: boolean;
    error?: string;
    ready?: boolean;
}) {
    const [mode, setMode] = useState(initialMode);
    const vm = useMockedViewModel(
        {
            roomName: "Product studio",
            documentName: "Release checklist",
            mode,
            ready,
            canEdit,
            sync: !ready ? ("loading" as const) : error ? ("error" as const) : ("saved" as const),
            pendingUpdates: error ? 1 : 0,
            wordCount: markdown.trim().split(/\s+/).length,
            characterCount: markdown.length,
            html,
            error,
        },
        { setMode, retry: fn(async () => {}) },
    );
    return (
        <div style={{ height: "100dvh" }}>
            <RoomDocsView
                vm={vm}
                editor={
                    <textarea
                        aria-label="Markdown document"
                        defaultValue={markdown}
                        readOnly={!canEdit}
                        spellCheck={false}
                        style={{
                            display: "block",
                            width: "100%",
                            height: "100%",
                            boxSizing: "border-box",
                            resize: "none",
                            padding: "24px",
                            border: 0,
                            outlineOffset: "-2px",
                            font: "14px / 1.7 var(--cpd-font-family-mono)",
                            color: "var(--cpd-color-text-secondary)",
                            background: "var(--cpd-color-bg-canvas-default)",
                            tabSize: 4,
                        }}
                    />
                }
                onDownload={fn()}
                onFormat={fn()}
            />
        </div>
    );
}

const meta = { title: "Room/RoomDocs", component: RoomDocsView, parameters: { layout: "fullscreen" } } satisfies Meta<
    typeof RoomDocsView
>;
export default meta;

/** The source and live preview share the available workspace. */
export const Split: StoryObj = { render: () => <DocsWorkspace /> };
/** A focused Markdown editor without the preview pane. */
export const Edit: StoryObj = { render: () => <DocsWorkspace initialMode="edit" /> };
/** Readable document typography in the full-width preview. */
export const Preview: StoryObj = { render: () => <DocsWorkspace initialMode="preview" /> };
/** Read-only members can still change modes, find text, and download. */
export const ReadOnly: StoryObj = { render: () => <DocsWorkspace initialMode="preview" canEdit={false} /> };
/** Failed changes stay visible with the existing retry action. */
export const SaveError: StoryObj = {
    render: () => <DocsWorkspace error="Your changes are not saved yet. Check your connection and retry." />,
};
/** Loading uses the same stable editor mount and workspace structure. */
export const Loading: StoryObj = { render: () => <DocsWorkspace ready={false} canEdit={false} /> };
