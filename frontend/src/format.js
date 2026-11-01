export function formatTime(value) {
    if (!value) {
        return "Unknown time";
    }

    return new Date(value).toLocaleString();
}

export function shortSha(sha) {
    if (!sha) {
        return "—";
    }

    return sha.slice(0, 7);
}

export function confidencePercent(confidence) {
    const value = Number(confidence);

    if (Number.isNaN(value)) {
        return "—";
    }

    return `${Math.round(value * 100)}%`;
}

export function issueTotal(counts) {
    if (!counts) {
        return 0;
    }

    return (counts.critical ?? 0)
        + (counts.high ?? 0)
        + (counts.medium ?? 0)
        + (counts.low ?? 0);
}
