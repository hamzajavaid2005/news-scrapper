import express from "express";
import { serve } from "inngest/express";
import { inngest, functions } from "./inngest/index.js";
import { connectDB } from "./prisma.js";
import { log, flushLogs, isAxiomConfigured } from "./lib/logger.js";
import webhookRoutes from "./routes/webhooks.js";
import siteRoutes from "./routes/sites.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: "50mb" }));

// Health check endpoint
app.get("/", (req, res) => {
    res.json({
        status: "running",
        message: "News Scraper with Inngest + Supabase",
        inngestDashboard: "http://localhost:8288",
        logging: isAxiomConfigured ? "axiom" : "console",
    });
});

// Health check endpoint for Docker
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "healthy",
        timestamp: new Date().toISOString(),
    });
});

// Inngest endpoint - this is where Inngest sends requests
app.use(
    "/api/inngest",
    serve({
        client: inngest,
        functions: functions,
        // signingKey: process.env.INNGEST_SIGNING_KEY,
    })
);

// Webhook management API
app.use("/api/webhooks", webhookRoutes);

// Site self-registration API
app.use("/api/sites", siteRoutes);

// Start server
async function start() {
    try {
        // Connect to Supabase
        await connectDB();

        app.listen(PORT, () => {
            console.log("");
            console.log("═".repeat(60));
            console.log("🚀 NEWS SCRAPER SERVER STARTED");
            console.log("═".repeat(60));
            console.log(`   Server:           http://localhost:${PORT}`);
            console.log(
                `   Inngest Endpoint: http://localhost:${PORT}/api/inngest`
            );
            console.log(`   Database:         Supabase (PostgreSQL)`);
            console.log(
                `   Logging:          ${isAxiomConfigured ? "✅ Axiom + Console" : "📝 Console only"}`
            );
            console.log("");
            console.log("📋 NEXT STEPS:");
            console.log(
                "   1. In another terminal, run the Inngest dev server:"
            );
            console.log(
                "      npx inngest-cli@latest dev -u http://localhost:3000/api/inngest"
            );
            console.log("");
            console.log("   2. Open Inngest dashboard: http://localhost:8288");
            console.log("");
            console.log(
                "   3. The scraper will run automatically every 15 minutes"
            );
            console.log("      Or trigger manually from the dashboard");
            console.log("═".repeat(60));

            // Log startup to Axiom
            log.info("Server started", {
                port: PORT,
                axiomEnabled: isAxiomConfigured,
                environment: process.env.NODE_ENV || "development",
            });
        });
    } catch (error) {
        console.error("Failed to start server:", error);
        log.error("Server startup failed", error);
        await flushLogs();
        process.exit(1);
    }
}

// Graceful shutdown - flush logs before exit
async function shutdown(signal) {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    log.info("Server shutting down", { signal });
    await flushLogs();
    process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start();
