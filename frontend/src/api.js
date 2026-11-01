const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

export async function fetchRuns() {
    const response = await fetch(`${API_URL}/reviews`);

    if (!response.ok) {
        throw new Error("Failed to load review runs");
    }

    return response.json();
}

export async function fetchRun(id) {
    const response = await fetch(`${API_URL}/reviews/${id}`);

    if (response.status === 404) {
        throw new Error("Review run not found");
    }

    if (!response.ok) {
        throw new Error("Failed to load review run");
    }

    return response.json();
}
