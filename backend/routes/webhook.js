import express from "express"
const router = express.Router();

router.post('/',async (req,res)=>{
        console.log("webhook triggered")
    const action = await req.body.action;
    if (action !== "opened" && action !== "reopened") {
        return res.status(200).send("ignored")
    }

    const prId = req.body.pull_request.number;
    const repoName = req.body.repository.name;
    const username = req.body.repository.owner.login;
    const commitSha = req.body.pull_request.head.sha;

    const response = await fetch("http://localhost:3009/github-api", {
        method: "post",
        headers: {
            "content-type": "application/json"
        },
        body: JSON.stringify({
            prId,
            repoName,
            username,
            commitSha
        })
    })

    res.send("hii");
})

export default router