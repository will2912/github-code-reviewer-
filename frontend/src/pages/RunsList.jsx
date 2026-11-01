import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchRuns } from "../api.js";
import { formatTime, issueTotal, shortSha } from "../format.js";

const POLL_MS = 5000;

export default function RunsList() {
    const [runs, setRuns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;

        async function load(initial = false) {
            try {
                const data = await fetchRuns();

                if (!cancelled) {
                    setRuns(Array.isArray(data) ? data : []);
                    setError("");
                }
            } catch (loadError) {
                if (!cancelled) {
                    setError(loadError.message || "Failed to load review runs");
                }
            } finally {
                if (!cancelled && initial) {
                    setLoading(false);
                }
            }
        }

        load(true);
        const timer = setInterval(() => load(), POLL_MS);

        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, []);

    const totalIssues = runs.reduce(
        (sum, run) => sum + issueTotal(run.issueCounts),
        0
    );

    const commentsPosted = runs.filter(
        (run) => run.githubCommentPosted
    ).length;

    return (
        <main className="page">
            <header className="page-header dashboard-header">
                <div>
                    <p className="eyebrow">GITHUB CODE REVIEWER</p>
                    <h1>Review dashboard</h1>
                    <p className="muted">
                        Monitor automated pull request reviews and findings.
                    </p>
                </div>

                <div className="live-indicator">
                    <span className="live-dot" />
                    Auto-refresh · 5 seconds
                </div>
            </header>

            {!loading && !error && (
                <section className="overview-grid">
                    <OverviewCard
                        label="Total reviews"
                        value={runs.length}
                        description="Pull requests analyzed"
                    />
                    <OverviewCard
                        label="Total findings"
                        value={totalIssues}
                        description="Issues detected"
                    />
                    <OverviewCard
                        label="Comments posted"
                        value={commentsPosted}
                        description="GitHub review comments"
                    />
                </section>
            )}

            <section className="runs-section">
                <div className="section-heading">
                    <div>
                        <h2>Recent reviews</h2>
                        <p className="muted">
                            Latest pull request analysis results
                        </p>
                    </div>

                    {!loading && !error && (
                        <span className="run-count">
                            {runs.length} {runs.length === 1 ? "review" : "reviews"}
                        </span>
                    )}
                </div>

                {loading && (
                    <div className="status">
                        Loading review runs...
                    </div>
                )}

                {!loading && error && (
                    <div className="status error">
                        <strong>Unable to load reviews</strong>
                        <p>{error}</p>
                        <p className="muted">
                            Check whether Redis and the API are running on port 3009.
                        </p>
                    </div>
                )}

                {!loading && !error && runs.length === 0 && (
                    <div className="status empty-state">
                        <h3>No review runs yet</h3>
                        <p className="muted">
                            Open or reopen a GitHub pull request to trigger your first review.
                        </p>
                    </div>
                )}

                {!loading && !error && runs.length > 0 && (
                    <div className="run-list">
                        {runs.map((run) => {
                            const total = issueTotal(run.issueCounts);

                            return (
                                <Link
                                    key={run.id}
                                    to={`/runs/${run.id}`}
                                    className="run-card"
                                >
                                    <div className="run-card-top">
                                        <div className="run-title-group">
                                            <strong>
                                                {run.username}/{run.repoName}
                                            </strong>
                                            <span className="pr-label">
                                                PR #{run.prId}
                                            </span>
                                        </div>

                                        <span className="run-open-link">
                                            View details <span aria-hidden="true">→</span>
                                        </span>
                                    </div>

                                    <div className="run-card-meta muted">
                                        <span>{formatTime(run.createdAt)}</span>
                                        <span>Commit {shortSha(run.commitSha)}</span>
                                        <span>{run.fileCount ?? 0} files analyzed</span>
                                    </div>

                                    <div className="chip-row">
                                        <SeverityChip
                                            label="critical"
                                            count={run.issueCounts?.critical}
                                        />
                                        <SeverityChip
                                            label="high"
                                            count={run.issueCounts?.high}
                                        />
                                        <SeverityChip
                                            label="medium"
                                            count={run.issueCounts?.medium}
                                        />
                                        <SeverityChip
                                            label="low"
                                            count={run.issueCounts?.low}
                                        />
                                    </div>

                                    <div className="run-card-footer">
                                        <span className={`badge ${total === 0 ? "ok" : "warn"}`}>
                                            {total === 0 ? "No issues" : `${total} findings`}
                                        </span>

                                        <span className={`badge ${
                                            run.githubCommentPosted ? "posted" : "muted-badge"
                                        }`}>
                                            {run.githubCommentPosted
                                                ? "Comment posted"
                                                : "No comment posted"}
                                        </span>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </section>
        </main>
    );
}

function OverviewCard({ label, value, description }) {
    return (
        <article className="overview-card">
            <p className="overview-label">{label}</p>
            <strong className="overview-value">{value}</strong>
            <p className="overview-description">{description}</p>
        </article>
    );
}

function SeverityChip({ label, count }) {
    return (
        <span className={`chip severity-${label}`}>
            {label} {count ?? 0}
        </span>
    );
}