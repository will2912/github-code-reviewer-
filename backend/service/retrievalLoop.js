import { createRepoReader } from "./repoReader.js";
import { buildPathIndex, resolveRequest, extractEvidence } from "./importResolver.js";
import { buildReviewPrompt } from "./promptBuilder.js";
import { callLLM } from "./llmClient.js";
import { parseModelJson, validateFindings } from "./findingsValidator.js";

const DEFAULTS = {
    maxRetrievalRounds: 2,      // so at most 3 LLM calls
    maxFetches: 8,              // real GitHub requests (PR files are free)
    maxRequestsPerRound: 4,
    maxRetrievedChars: 30000
};

function normalizeRequests(list) {
    const out = [];

    for (const item of Array.isArray(list) ? list : []) {
        if (!item || typeof item !== "object") continue;

        const why = String(item.why ?? "").slice(0, 300);
        const from = item.from ? String(item.from).trim() : null;
        const name = String(item.name ?? "").trim();
        const path = String(item.path ?? "").trim();

        if (item.type === "symbol" && name) {
            out.push({ type: "symbol", name, from, why });
        } else if (item.type === "symbol" && /^[A-Za-z_$][\w$]*$/.test(path)) {
            out.push({ type: "symbol", name: path, from, why });
        } else if (path) {
            out.push({ type: "file", path, from, why });
        } else if (name) {
            out.push({ type: "symbol", name, from, why });
        }
    }

    return out;
}

const requestKey = r =>
    r.type === "symbol" ? `symbol:${r.name.toLowerCase()}` : `file:${r.path.toLowerCase()}`;

const requestLabel = r => (r.type === "symbol" ? `symbol ${r.name}` : `file ${r.path}`);

function addUsage(total, usage) {
    if (!usage) return;

    for (const key of ["promptTokens", "completionTokens", "totalTokens"]) {
        if (Number.isFinite(usage[key])) total[key] += usage[key];
    }
}

export function compareRounds(first, final) {
    const firstKeys = new Set(first.map(f => f.fingerprint));
    const finalKeys = new Set(final.map(f => f.fingerprint));
    const brief = f => ({ path: f.path, line: f.line, side: f.side, title: f.title });

    return {
        confirmed: final.filter(f => firstKeys.has(f.fingerprint)).map(brief),
        dropped: first.filter(f => !finalKeys.has(f.fingerprint)).map(brief),
        added: final.filter(f => !firstKeys.has(f.fingerprint)).map(brief)
    };
}

export async function runReviewWithRetrieval({
    owner,
    repo,
    collected,
    context,
    staticResults,
    options = {}
}) {
    const cfg = { ...DEFAULTS, ...options };

    const reader = createRepoReader({
        owner,
        repo,
        ref: collected.pr.headSha,
        seedFiles: collected.files,
        maxFetches: cfg.maxFetches
    });

    // Head source of every file we hold, used to look up imports.
    const sources = new Map(
        collected.files
            .filter(file => typeof file.content === "string")
            .map(file => [file.path, file.content])
    );

    const retrieved = { files: [], unavailable: [] };
    const tried = new Set();
    const rounds = [];
    const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const totalRounds = cfg.maxRetrievalRounds + 1;

    let retrievedChars = 0;
    let lastGood = null;
    let firstRound = null;
    let stopReason = "";
    let index = null;
    let aliases = null;

    for (let round = 1; round <= totalRounds; round++) {
        const isLast = round === totalRounds;

        const { messages } = buildReviewPrompt(context, staticResults, {
            retrieved,
            round,
            finalRound: isLast
        });

        const response = await callLLM(messages);
        addUsage(usage, response.usage);

        const parsed = parseModelJson(response.content);

        if (!parsed.ok) {
            rounds.push({ round, error: parsed.error, tokens: response.usage?.totalTokens ?? null });

            if (!lastGood) {
                return {
                    status: "model_output_unreadable",
                    error: parsed.error,
                    raw: response.content,
                    rounds,
                    usage,
                    fetches: reader.fetchCount()
                };
            }

            stopReason = `round ${round} output was unreadable; kept round ${lastGood.round}`;
            break;
        }

        const validated = validateFindings(parsed.value, context);
        lastGood = { round, validated };
        if (!firstRound) firstRound = lastGood;

        const asked = normalizeRequests(parsed.value.needsMoreContext);
const requests = asked
    .filter(r => !tried.has(requestKey(r)))
    .slice(0, cfg.maxRequestsPerRound);

        const info = {
            round,
            tokens: response.usage?.totalTokens ?? null,
            accepted: validated.accepted.length,
            rejected: validated.rejected.length,
            requests,
            retrievedNow: [],
            unavailableNow: []
        };
        rounds.push(info);

        if (requests.length === 0) {
            stopReason =
    asked.length > 0
        ? "only repeated or unavailable requests remain"
        : round === 1
            ? "no extra context requested"
            : "the model needs nothing more";
            break;
        }

        if (isLast) {
            stopReason = "retrieval round limit reached";
            break;
        }

        if (!index) {
            const tree = await reader.getTree();
            aliases = await reader.getAliases();
            index = buildPathIndex(tree.paths);
        }

        for (const request of requests) {
            tried.add(requestKey(request));

            const fail = reason => {
                info.unavailableNow.push({ label: requestLabel(request), reason });
                retrieved.unavailable.push({ label: requestLabel(request), reason });
            };

            const resolved = resolveRequest(request, { index, aliases, sources });

            if (!resolved.ok) { fail(resolved.reason); continue; }

            if (retrieved.files.some(f => f.path === resolved.path && f.symbol === resolved.symbol)) {
                fail("already provided");
                continue;
            }

            const file = await reader.readFile(resolved.path);

            if (!file.ok) { fail(file.reason); continue; }

            sources.set(resolved.path, file.content);

            const evidence = extractEvidence({
                path: resolved.path,
                content: file.content,
                symbol: resolved.symbol
            });

            if (retrievedChars + evidence.code.length > cfg.maxRetrievedChars) {
                fail("evidence size budget used up");
                continue;
            }

            retrievedChars += evidence.code.length;
            retrieved.files.push({ ...evidence, why: request.why });
            info.retrievedNow.push({
                path: evidence.path,
                symbol: evidence.symbol,
                ranges: evidence.ranges,
                chars: evidence.code.length,
                note: evidence.note,
                cached: file.cached
            });
        }

        if (info.retrievedNow.length === 0) {
            stopReason = "none of the requested code could be retrieved";
            break;
        }
    }

    const final = lastGood.validated;

    return {
        status: "ok",
        stopReason,
        finalRound: lastGood.round,
        rounds,
        retrieved: retrieved.files.map(f => ({
            path: f.path,
            symbol: f.symbol,
            ranges: f.ranges,
            chars: f.code.length,
            note: f.note,
            why: f.why
        })),
        unavailable: retrieved.unavailable,
        summary: final.summary,
        accepted: final.accepted,
        rejected: final.rejected,
        needsMoreContext: final.needsMoreContext,
        firstRoundAccepted: firstRound.validated.accepted,
        changes: compareRounds(firstRound.validated.accepted, final.accepted),
        usage,
        fetches: reader.fetchCount()
    };
}