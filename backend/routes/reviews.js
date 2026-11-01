import express from "express";
import { getReviewRun, listReviewRuns } from "../service/reviewStore.js";

const router = express.Router();

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

router.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", FRONTEND_ORIGIN);
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

router.get("/", async (_req, res) => {
    try {
        const runs = await listReviewRuns();
        return res.json(runs);
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            error: "Failed to list review runs",
        });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const run = await getReviewRun(req.params.id);

        if (!run) {
            return res.status(404).json({
                error: "Review run not found",
            });
        }

        return res.json(run);
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            error: "Failed to load review run",
        });
    }
});

export default router;
