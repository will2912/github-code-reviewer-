
export function parsePatch(patch = "") {
    const regions = [];
    const hunks = [];

    const left = new Set();
    const right = new Set();

    if (typeof patch !== "string" || !patch) {
        return {
            regions: [],
            commentableLines: { left: [], right: [] },
            hunks: []
        };
    }

    const lines = patch.split("\n");

    let oldLine = null;
    let newLine = null;
    let hunk = null;
    let changes = [];
    let contextBefore = [];
    let hunkIndex = 0;

    const CONTEXT_SIZE = 3;

    function closeRegion(contextAfter = []) {
        if (!changes.length || !hunk) return;

        const added = changes
            .filter(item => item.type === "added")
            .map(item => ({
                line: item.newLine,
                side: "RIGHT",
                text: item.content
            }));

        const removed = changes
            .filter(item => item.type === "removed")
            .map(item => ({
                line: item.oldLine,
                side: "LEFT",
                text: item.content
            }));

        const oldNumbers = removed.map(item => item.line);
        const newNumbers = added.map(item => item.line);

        const first = changes[0];

        // A deletion has no new-side line. Its anchor is the
        // current new-file cursor where the deletion occurred.
        const oldAnchor = first.oldLine ?? first.oldAnchor;
        const newAnchor = first.newLine ?? first.newAnchor;

        const region = {
            id: `region-${regions.length + 1}`,
            hunkIndex,

            startLine: newNumbers.length
                ? Math.min(...newNumbers)
                : newAnchor,

            endLine: newNumbers.length
                ? Math.max(...newNumbers)
                : newAnchor,

            oldStartLine: oldNumbers.length
                ? Math.min(...oldNumbers)
                : oldAnchor,

            oldEndLine: oldNumbers.length
                ? Math.max(...oldNumbers)
                : oldAnchor,

            oldRange: {
                startLine: oldNumbers.length
                    ? Math.min(...oldNumbers)
                    : oldAnchor,
                endLine: oldNumbers.length
                    ? Math.max(...oldNumbers)
                    : oldAnchor
            },

            newRange: {
                startLine: newNumbers.length
                    ? Math.min(...newNumbers)
                    : newAnchor,
                endLine: newNumbers.length
                    ? Math.max(...newNumbers)
                    : newAnchor
            },

            isPureAddition: added.length > 0 && removed.length === 0,
            isPureDeletion: removed.length > 0 && added.length === 0,

            added,
            removed,
            addedLines: newNumbers,
            removedLines: oldNumbers,

            changedLines: {
                old: oldNumbers,
                new: newNumbers
            },

            diff: changes.map(item => ({
                type: item.type,
                oldLine: item.oldLine,
                newLine: item.newLine,
                content: item.content
            })),

            contextBefore: [...contextBefore],
            contextAfter: [...contextAfter]
        };

        regions.push(region);
        hunk.regions.push(region);

        changes = [];
        contextBefore = [];
    }

    function closeHunk() {
        if (!hunk) return;

        closeRegion([]);
        hunks.push(hunk);
        hunk = null;
        contextBefore = [];
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const match = line.match(
            /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
        );

        if (match) {
            closeHunk();

            hunkIndex++;

            oldLine = Number(match[1]);
            newLine = Number(match[3]);

            hunk = {
                index: hunkIndex,
                oldStartLine: oldLine,
                oldLineCount: Number(match[2] ?? 1),
                newStartLine: newLine,
                newLineCount: Number(match[4] ?? 1),
                regions: []
            };

            continue;
        }

        if (!hunk) continue;

        if (line.startsWith("\\ No newline at end of file")) {
            continue;
        }

        if (line.startsWith(" ")) {
            // Capture upcoming context for the region being closed.
            if (changes.length) {
                const following = [];

                let nextOld = oldLine;
                let nextNew = newLine;

                for (
                    let j = i;
                    j < lines.length && following.length < CONTEXT_SIZE;
                    j++
                ) {
                    if (!lines[j].startsWith(" ")) break;

                    following.push({
                        oldLine: nextOld,
                        newLine: nextNew,
                        content: lines[j].slice(1)
                    });

                    nextOld++;
                    nextNew++;
                }

                closeRegion(following);
            }

            left.add(oldLine);
            right.add(newLine);

            contextBefore.push({
                oldLine,
                newLine,
                content: line.slice(1)
            });

            if (contextBefore.length > CONTEXT_SIZE) {
                contextBefore.shift();
            }

            oldLine++;
            newLine++;
            continue;
        }

        if (line.startsWith("-")) {
            changes.push({
                type: "removed",
                oldLine,
                newLine: null,
                oldAnchor: oldLine,
                newAnchor: newLine,
                content: line.slice(1)
            });

            left.add(oldLine);
            oldLine++;
            continue;
        }

        if (line.startsWith("+")) {
            changes.push({
                type: "added",
                oldLine: null,
                newLine,
                oldAnchor: oldLine,
                newAnchor: newLine,
                content: line.slice(1)
            });

            right.add(newLine);
            newLine++;
        }
    }

    closeHunk();

    return {
        regions,
        commentableLines: {
            left: [...left].sort((a, b) => a - b),
            right: [...right].sort((a, b) => a - b)
        },
        hunks
    };
}
