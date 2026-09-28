import express from "express"
const router = express.Router();

router.post('/',async (req,res)=>{
    try {
        const {
            prId,
            repoName,
            username,
            reviewBody
        } = req.body;

        const response = await fetch(
            `https://api.github.com/repos/${username}/${repoName}/issues/${prId}/comments`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`,
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    body: reviewBody
                })
            }
        );

        const data = await response.json();

        console.log("GitHub response:", data);

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        res.json({
            message: "Review comment created successfully",
            comment: data
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Failed to create review comment"
        });
    }
})

export default router