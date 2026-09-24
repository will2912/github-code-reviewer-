import {createClient} from "redis"

const redis = createClient({
    url:'redis://localhost:6379'
})

redis.on("error",(err)=>{
    console.error("redis error:", err)
})

await redis.connect();

export default redis;