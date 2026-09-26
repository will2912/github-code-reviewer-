import express from "express";
const app = express();
import dotenv from "dotenv"
dotenv.config();
app.use(express.json());
const GITHUB_API="https://api.github.com"
import { detectLanguage } from "./service/languageDetector.js";
import { selectAnalyzer } from "./service/analyzerSelector.js";
import { runStaticAnalyzer } from "./service/staticAnalyzer.js";
import { normalizeFindings } from "./service/findingNormalizer.js";

app.post("/webhook", async(req, res) => {
    console.log("webhook triggered")
    const action = await req.body.action;
    if(action !== "opened" && action !== "reopened"){
        return res.status(200).send("ignored")
    }

    const prId = req.body.pull_request.number;
    const repoName = req.body.repository.name;
    const username = req.body.repository.owner.login;
    const commitSha = req.body.pull_request.head.sha;

    const response = await fetch("http://localhost:3009/github-api",{
        method: "post",
        headers:{
            "content-type": "application/json"
        },
        body:JSON.stringify({
            prId,
            repoName,
            username,
            commitSha
        })
    })

    res.send("hii");
    
});
//////////////////////////////////////////////////////////////////////////




app.post("/github-api", async (req, res) => {
    try {
        console.log("api triggered");

        const {
            prId,
            repoName,
            username,
            commitSha
        } = req.body;

        // Get files changed by the PR
        const response = await fetch(
            `${GITHUB_API}/repos/${username}/${repoName}/pulls/${prId}/files?per_page=100`,
            {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`,
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28"
                }
            }
        );

        const changedFiles = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(changedFiles);
        }

        const filesWithContent = [];
        const allFindings = [];

        for (const file of changedFiles) {
            
            const contentResponse = await fetch(
                `${GITHUB_API}/repos/${username}/${repoName}/contents/${file.filename}?ref=${commitSha}`,
                {
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`,
                        "Accept": "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2022-11-28"
                    }
                }
            );

            const contentData = await contentResponse.json();

            if (!contentResponse.ok) {
                console.log(
                    `Could not fetch content for ${file.filename}`,
                    contentData
                );
                continue;
            }

            const sourceCode = Buffer.from(
                contentData.content,
                "base64"
            ).toString("utf-8");

            const currentFile = {
    filename: file.filename,
    content: sourceCode
};

filesWithContent.push(currentFile);


    const language = detectLanguage(file.filename);
    const analyzer = selectAnalyzer(language);

    if (analyzer === "eslint") {
    const findings = await runStaticAnalyzer(currentFile);

    const normalizedFindings = normalizeFindings(
        currentFile.filename,
        findings.messages
    );
    allFindings.push(...normalizedFindings)


}
        }

       // console.log("Files with source content:", filesWithContent);
        console.log("ALL FINDINGS:");
console.log(allFindings);
        return res.json(filesWithContent);

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            error: "Failed to retrieve PR files"
        });
    }
});


app.post("/github-diff",async (req,res)=>{
    try{
        console.log("api triggered")
        const {prId,repoName,username}= req.body;
        const response = await fetch(`${GITHUB_API}/repos/${username}/${repoName}/pulls/${prId}/files?per_page=100`,{
             method: "GET",
                headers: {
                    "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`,
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                    "Content-Type": "application/json"
                },
        })
         const data = await response.json();

        console.log("GitHub final diff response:", data);

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        return res.json(data);

    }
    catch(error){
        console.error(error)
    }
})


app.post("/github-comment",async (req,res)=>{
    try{
        const {prId,repoName,username}= req.body;
        const response = await fetch(`https://api.github.com/repos/${username}/${repoName}/issues/${prId}/comments`,{
             method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`,
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    body: "Hello from my Code Reviewer 🚀"
                })
        })
         const data = await response.json();

        console.log("GitHub response:", data);

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        res.json({
            message: "Comment created successfully",
            comment: data
        });

    }
    catch(error){
        console.error(error)
    }
})



app.listen(3009,()=>{
    console.log("listening")
})

