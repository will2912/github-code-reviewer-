
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;

function getParserPlugins(path) {
    if (path.endsWith(".tsx")) return ["typescript", "jsx", "decorators-legacy"];
    if (path.endsWith(".ts")) return ["typescript", "decorators-legacy"];
    return ["jsx", "decorators-legacy"];
}

function getKeyName(key) {
    if (!key) return null;
    if (key.type === "PrivateName") return `#${key.id.name}`;
    return String(key.name ?? key.value ?? "");
}

function getClassName(nodePath) {
    const classPath = nodePath.findParent(p => p.isClass());
    return classPath?.node.id?.name ?? null;
}

function resolveName(nodePath) {
    const node = nodePath.node;

    if (node.id?.name) return node.id.name;

    if (
        node.type === "ClassMethod" ||
        node.type === "ClassPrivateMethod" ||
        node.type === "ObjectMethod"
    ) {
        const keyName = getKeyName(node.key) || "anonymous";
        const className = getClassName(nodePath);
        return className ? `${className}.${keyName}` : keyName;
    }

    const parent = nodePath.parent;

    if (parent?.type === "VariableDeclarator" && parent.id?.name) {
        const className = getClassName(nodePath);
        return className ? `${className}.${parent.id.name}` : parent.id.name;
    }

    if (parent?.type === "ObjectProperty" && parent.key) {
        return getKeyName(parent.key) || null;
    }

    if (
        (parent?.type === "ClassProperty" ||
            parent?.type === "ClassPrivateProperty") &&
        parent.key
    ) {
        const className = getClassName(nodePath);
        const keyName = getKeyName(parent.key);
        return className ? `${className}.${keyName}` : keyName;
    }

    return null;
}

function getKind(node, nodePath) {
    if (
        node.type === "ClassDeclaration" ||
        node.type === "ClassExpression"
    ) return "class";

    if (
        node.type === "ClassMethod" ||
        node.type === "ClassPrivateMethod" ||
        node.type === "ObjectMethod"
    ) return "method";

    if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
    ) return "function";

    if (node.type === "VariableDeclaration") return "variable";
    if (node.type === "ImportDeclaration") return "import";

    if (
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportDefaultDeclaration" ||
        node.type === "ExportAllDeclaration"
    ) return "export";

    if (
        node.type === "ClassProperty" ||
        node.type === "ClassPrivateProperty"
    ) return "property";

    if (
        node.type === "TSTypeAliasDeclaration" ||
        node.type === "TSInterfaceDeclaration" ||
        node.type === "TSEnumDeclaration" ||
        node.type === "TSDeclareFunction"
    ) return "declaration";

    return nodePath.isStatement() ? "statement" : "declaration";
}

function makeRange(nodePath, content) {
    const node = nodePath.node;

    if (!node.loc || node.start == null || node.end == null) {
        return null;
    }

    const name = resolveName(nodePath);

    return {
        name: name || "anonymous",
        named: Boolean(name),
        kind: getKind(node, nodePath),
        startLine: node.loc.start.line,
        endLine: node.loc.end.line,
        start: node.start,
        end: node.end,
        content: content.slice(node.start, node.end)
    };
}

const STRUCTURAL_NODE_TYPES = [
    "FunctionDeclaration",
    "FunctionExpression",
    "ArrowFunctionExpression",
    "ClassMethod",
    "ClassPrivateMethod",
    "ObjectMethod",
    "ClassDeclaration",
    "ClassExpression",
    "VariableDeclaration",
    "ImportDeclaration",
    "ExportNamedDeclaration",
    "ExportDefaultDeclaration",
    "ExportAllDeclaration",
    "ClassProperty",
    "ClassPrivateProperty",
    "TSDeclareFunction",
    "TSTypeAliasDeclaration",
    "TSInterfaceDeclaration",
    "TSEnumDeclaration"
].join("|");

export function getStructureRanges(content, path) {
    let ast;

    try {
        ast = parse(content, {
            sourceType: "unambiguous",
            errorRecovery: true,
            ranges: true,
            plugins: getParserPlugins(path)
        });
    } catch (error) {
        return {
            ok: false,
            ranges: [],
            error: error.message
        };
    }

    const ranges = [];

    try {
        traverse(ast, {
            [STRUCTURAL_NODE_TYPES](nodePath) {
                const range = makeRange(nodePath, content);
                if (range) ranges.push(range);
            }
        });
    } catch (error) {
        return {
            ok: false,
            ranges: [],
            error: error.message
        };
    }

    const unique = new Map();

    for (const range of ranges) {
        unique.set(
            `${range.start}:${range.end}:${range.kind}`,
            range
        );
    }

    return {
        ok: true,
        hasParseErrors: Boolean(ast.errors?.length),
        parseErrors: (ast.errors ?? []).map(error => error.message),
        ranges: [...unique.values()].sort(
            (a, b) => a.start - b.start || b.end - a.end
        )
    };
}

function isFunctionKind(kind) {
    return kind === "function" || kind === "method";
}

function containsLine(range, line) {
    return range.startLine <= line && line <= range.endLine;
}

function uniqueLines(lines = []) {
    return [...new Set(lines.filter(Number.isInteger))]
        .sort((a, b) => a - b);
}


function getChangedLines(region) {
    const changed = region.changedLines;

    // Support the parser's { old: [], new: [] } format,
    // as well as a normalized array supplied by the context builder.
    const changedArray = Array.isArray(changed)
        ? changed
        : [
            ...(changed?.new ?? []),
            ...(changed?.old ?? [])
        ];

    return uniqueLines([
        ...changedArray,
        ...(region.addedLines ?? []),
        ...(region.newLines ?? []),
        region.startLine,
        region.endLine,
        region.newRange?.startLine,
        region.newRange?.endLine
    ]);
}

export function findBlockForRegion(content, structure, region) {
    if (!structure?.ok || !Array.isArray(structure.ranges)) {
        return { ok: false, error: "Valid structure ranges are required." };
    }

    const changedLines = getChangedLines(region);

    if (changedLines.length === 0) {
        return { ok: false, error: "Region has no usable changed line numbers." };
    }

    const ranges = structure.ranges;
    const sizeOf = range => range.end - range.start;
    const enclosesAll = range =>
        changedLines.every(line => containsLine(range, line));

    const functionCandidates = ranges
        .filter(range => isFunctionKind(range.kind) && enclosesAll(range))
        .sort((a, b) => sizeOf(a) - sizeOf(b));

    // Prefer the smallest NAMED function. Anonymous callbacks such as
    // useEffect(() => {...}) or .map(x => ...) are used only when
    // no named function encloses the change.
    let selected =
        functionCandidates.find(range => range.named) ??
        functionCandidates[0] ??
        null;

    if (!selected) {
        selected =
            ranges
                .filter(range => !isFunctionKind(range.kind) && enclosesAll(range))
                .sort((a, b) => sizeOf(a) - sizeOf(b))[0] ?? null;
    }

    if (!selected) {
        return {
            ok: false,
            error: "No enclosing function/method or declaration found."
        };
    }

    return {
        ok: true,
        block: {
            kind: selected.kind,
            symbol: selected.name,
            startLine: selected.startLine,
            endLine: selected.endLine,
            start: selected.start,
            end: selected.end,
            content: content.slice(selected.start, selected.end)
        }
    };
}

export function buildBlocksForRegions(content, path, regions) {
    const structure = getStructureRanges(content, path);

    if (!structure.ok) {
        return {
            ok: false,
            error: structure.error,
            blocks: [],
            regions,
            structure
        };
    }

    const blocks = [];
    const blockIdsByRange = new Map();

    for (const region of regions) {
        const result = findBlockForRegion(
            content,
            structure,
            region
        );

        if (!result.ok) {
            region.blockStatus = "unresolved";
            region.blockError = result.error;
            continue;
        }

        const block = result.block;
        const rangeKey = `${block.start}:${block.end}`;

        let blockId = blockIdsByRange.get(rangeKey);

        if (!blockId) {
            blockId = `B${blocks.length + 1}`;
            blockIdsByRange.set(rangeKey, blockId);

            blocks.push({
                id: blockId,
                ...block
            });
        }

        region.blockId = blockId;
        region.blockStatus = "complete";
        delete region.blockError;
    }

    return {
        ok: true,
        hasParseErrors: structure.hasParseErrors,
        parseErrors: structure.parseErrors,
        ranges: structure.ranges,
        blocks,
        regions
    };
}
