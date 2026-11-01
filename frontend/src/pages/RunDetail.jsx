import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchRun } from "../api.js";
import { confidencePercent, formatTime, issueTotal, shortSha } from "../format.js";

export default function RunDetail() {
    const { id } = useParams();
    const [run, setRun] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [showDismissed, setShowDismissed] = useState(false);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            setError("");

            try {
                const data = await fetchRun(id);

                if (!cancelled) {
                    setRun(data);
                }
            } catch (loadError) {
                if (!cancelled) {
                    setError(loadError.message || "Failed to load review run");
                    setRun(null);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        load();

        return () => {
            cancelled = true;
        };
    }, [id]);

    const total = issueTotal(run?.issueCounts);

    return (
        <main className="page">
            <header className="page-header">
                <div>
                    <Link to="/" className="back-link">All runs</Link>
                    <h1>Review detail</h1>
                    {run && (
                        <p className="muted">
                            {run.username}/{run.repoName} · PR #{run.prId} · {shortSha(run.commitSha)}
                        </p>
                    )}
                </div>
            </header>

            {loading && <p className="status">Loading review…</p>}

            {!loading && error && (
                <p className="status error">{error}. Is Redis and the API running on port 3009?</p>
            )}

            {!loading && run && (
                <>
                    <section className="summary-panel">
                        <div>
                            <span className="muted">Analyzed</span>
                            <strong>{formatTime(run.createdAt)}</strong>
                        </div>
                        <div>
                            <span className="muted">Status</span>
                            <strong>{run.status}</strong>
                        </div>
                        <div>
                            <span className="muted">Issues</span>
                            <strong>{total}</strong>
                        </div>
                        <div>
                            <span className="muted">GitHub comment</span>
                            <strong>{run.githubCommentPosted ? "Posted" : "Not posted"}</strong>
                        </div>
                    </section>

                    <div className="chip-row">
                        <span className="chip severity-critical">critical {run.issueCounts?.critical ?? 0}</span>
                        <span className="chip severity-high">high {run.issueCounts?.high ?? 0}</span>
                        <span className="chip severity-medium">medium {run.issueCounts?.medium ?? 0}</span>
                        <span className="chip severity-low">low {run.issueCounts?.low ?? 0}</span>
                        <span className="chip">dismissed {run.issueCounts?.dismissed ?? 0}</span>
                    </div>

                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={showDismissed}
                            onChange={(event) => setShowDismissed(event.target.checked)}
                        />
                        Include dismissed static findings
                    </label>

                    {(run.files ?? []).map((file) => {
                        const reviews = (file.reviews ?? []).filter(
                            (review) => showDismissed || review.isIssue
                        );

                        return (
                            <section key={file.filename} className="file-section">
                                <div className="file-header">
                                    <h2>{file.filename}</h2>
                                    <p className="muted">
                                        {file.language}
                                        {file.analyzerRan ? " · ESLint ran" : " · no analyzer"}
                                        {" · "}
                                        {file.findingCount} findings
                                    </p>
                                </div>

                                {reviews.length === 0 ? (
                                    <p className="muted">No issues to show for this file.</p>
                                ) : (
                                    reviews.map((review, index) => (
                                        <article
                                            key={`${file.filename}-${review.line}-${review.rule}-${index}`}
                                            className={`issue-card ${review.isIssue ? "" : "dismissed"}`}
                                        >
                                            <div className="issue-top">
                                                <span className={`chip severity-${review.severity || "low"}`}>
                                                    {review.severity || "unknown"}
                                                </span>
                                                <span>Line {review.line ?? "—"}</span>
                                                {review.rule && <span className="muted">{review.rule}</span>}
                                                {!review.isIssue && <span className="badge muted-badge">Dismissed</span>}
                                            </div>
                                            {review.message && (
                                                <p className="muted">{review.message}</p>
                                            )}
                                            <p>{review.explanation}</p>
                                            <p>
                                                <strong>Confidence:</strong> {confidencePercent(review.confidence)}
                                            </p>
                                            <p>
                                                <strong>Suggested fix:</strong> {review.suggestedFix}
                                            </p>
                                        </article>
                                    ))
                                )}
                            </section>
                        );
                    })}
                </>
            )}
        </main>
    );
}
