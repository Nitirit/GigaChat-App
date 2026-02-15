// Vercel Serverless Function
// Exposes the BACKEND_URL environment variable to the frontend at runtime.
// This replaces the need for proxy rewrites in vercel.json.
//
// Endpoint: GET /api/config
// Response: { "BACKEND_URL": "https://your-backend.example.com" }

export default function handler(req, res) {
  // Only allow GET requests
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Cache the config for 5 minutes to reduce function invocations,
  // but allow revalidation so env var changes propagate reasonably fast.
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=60");
  res.setHeader("Content-Type", "application/json");

  const backendUrl = process.env.BACKEND_URL || "";

  return res.status(200).json({
    BACKEND_URL: backendUrl.replace(/\/+$/, ""), // strip trailing slashes
  });
}
