import express from "express";
const app = express();
import dotenv from "dotenv"
dotenv.config();
app.use(express.json());

app.post("/webhook", async(req, res) => {
    console.log("webhook triggered")
    const action = await req.body.action;
    if(action !== "opened" && action !== "reopened"){
        return res.status(200).send("ignored")
    }

    const prId = req.body.pull_request.number;
    const repoName = req.body.repository.name;
    const username = req.body.repository.owner.login;

    const response = await fetch("http://localhost:3009/github-comment",{
        method: "post",
        headers:{
            "content-type": "application/json"
        },
        body:JSON.stringify({
            prId,
            repoName,
            username
        })
    })
});

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

