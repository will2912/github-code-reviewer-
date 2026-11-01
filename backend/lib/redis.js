import dotenv from "dotenv";
import { createClient } from "redis";

dotenv.config();

const redis = createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379",
});

redis.on("error", (err) => {
    console.error("redis error:", err);
});

await redis.connect();

export default redis;
