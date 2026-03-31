import express from "express";
import { prisma, connectDB } from "../prisma.js";
import { log } from "../lib/logger.js";
import crypto from "crypto";

const router = express.Router();

/**
 * Verify a WordPress registration token by calling back to the WP site.
 * This is the core security check — the scrapper calls WordPress, not the other way.
 */
async function verifyRegistrationToken(domain, token) {
    const result = {
        valid: false,
        secret: null,
        categories: [],
        dailyLimit: 7,
        maxDailyLimit: 50,
        growthRate: 0.1,
        pluginVersion: null,
        error: null,
    };

    try {
        // Build the verification URL on the WordPress site
        const verifyUrl = `${domain.replace(/\/$/, "")}/wp-json/news-automation/v1/register?token=${encodeURIComponent(token)}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(verifyUrl, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
            const body = await response.text();
            result.error = `WordPress responded with HTTP ${response.status}: ${body}`;
            return result;
        }

        const data = await response.json();

        // Validate the response shape from the plugin
        if (!data.secret || !data.domain) {
            result.error = "Invalid response from WordPress — plugin may not be installed correctly.";
            return result;
        }

        // Verify the domain in the WP response matches what was sent in the request
        // This prevents someone from registering with a fake domain
        const reportedDomain = data.domain.replace(/\/$/, "").toLowerCase();
        const requestedDomain = domain.replace(/\/$/, "").toLowerCase();

        if (reportedDomain !== requestedDomain) {
            result.error = `Domain mismatch: request said "${requestedDomain}" but WordPress reports "${reportedDomain}".`;
            return result;
        }

        result.valid = true;
        result.secret = data.secret;
        result.categories = data.categories || [];
        result.dailyLimit = data.dailyLimit || 7;
        result.maxDailyLimit = data.maxDailyLimit || 50;
        result.growthRate = data.growthRate || 0.1;
        result.pluginVersion = data.version || null;
    } catch (err) {
        if (err.name === "AbortError") {
            result.error = "Connection to WordPress timed out after 10 seconds.";
        } else {
            result.error = err.message;
        }
    }

    return result;
}

/**
 * POST /api/sites/register
 *
 * One-call registration from a WordPress site running the News Automation plugin.
 * The WordPress plugin's "Connect" button triggers this.
 *
 * Body: { name, domain, token }
 *
 * Flow:
 *  1. Validate input
 *  2. Check domain not already registered
 *  3. Call WordPress back to verify the token (domain binding)
 *  4. Create Webhook (active: FALSE — requires admin approval)
 *  5. Create RegisteredSite record
 *  6. Respond with { status: "pending" }
 */
router.post("/register", async (req, res) => {
    try {
        await connectDB();

        const { name, domain, token } = req.body;

        // --- Validation ---
        if (!name || !domain || !token) {
            return res.status(400).json({
                success: false,
                error: "name, domain, and token are required.",
            });
        }

        // Normalize domain
        const normalizedDomain = domain.replace(/\/$/, "").toLowerCase();

        // Check token format
        if (!token.startsWith("naw_reg_")) {
            return res.status(400).json({
                success: false,
                error: "Invalid token format. Must be a News Automation registration token.",
            });
        }

        // --- Check for duplicate domain ---
        const existingSite = await prisma.registeredSite.findUnique({
            where: { domain: normalizedDomain },
        });

        if (existingSite) {
            return res.status(409).json({
                success: false,
                error: `Domain "${normalizedDomain}" is already registered. Contact the admin to manage this site.`,
                siteId: existingSite.id,
                status: existingSite.status,
            });
        }

        // --- Verify token by calling WordPress ---
        log.info("Verifying registration token with WordPress", { domain: normalizedDomain });
        const verification = await verifyRegistrationToken(normalizedDomain, token);

        if (!verification.valid) {
            log.warn("Registration token verification failed", {
                domain: normalizedDomain,
                error: verification.error,
            });
            return res.status(401).json({
                success: false,
                error: `Token verification failed: ${verification.error}`,
            });
        }

        // --- Build publish URL ---
        const publishUrl = `${normalizedDomain}/wp-json/news-automation/v1/publish`;

        // --- Check webhook URL not already taken ---
        const existingWebhook = await prisma.webhook.findUnique({
            where: { url: publishUrl },
        });
        if (existingWebhook) {
            return res.status(409).json({
                success: false,
                error: "A webhook for this URL already exists.",
            });
        }

        // --- Hash the token for audit log (never store plaintext) ---
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

        // --- Create webhook (active: FALSE until admin approves) ---
        const webhook = await prisma.webhook.create({
            data: {
                name,
                url: publishUrl,
                active: false,                           // Requires admin approval
                secret: verification.secret,
                dailyLimit: verification.dailyLimit,
                maxDailyLimit: verification.maxDailyLimit,
                growthRate: verification.growthRate,
                categories: verification.categories,
                publishStartDay: new Date(),
            },
        });

        // --- Create RegisteredSite record ---
        const site = await prisma.registeredSite.create({
            data: {
                domain: normalizedDomain,
                name,
                tokenHash,
                status: "pending",
                webhookId: webhook.id,
            },
        });

        log.info("Site registered — pending admin approval", {
            siteId: site.id,
            domain: normalizedDomain,
            webhookId: webhook.id,
            pluginVersion: verification.pluginVersion,
        });

        return res.status(201).json({
            success: true,
            status: "pending",
            siteId: site.id,
            message: "Registration successful. Publishing is paused until an admin approves this site.",
            config: {
                categories: verification.categories,
                dailyLimit: verification.dailyLimit,
                maxDailyLimit: verification.maxDailyLimit,
                growthRate: verification.growthRate,
                pluginVersion: verification.pluginVersion,
            },
        });
    } catch (error) {
        log.error("Site registration failed", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/sites
 * List all registered sites.
 * Add ?status=pending to filter pending approvals.
 */
router.get("/", async (req, res) => {
    try {
        await connectDB();

        const { status } = req.query;
        const where = status ? { status } : {};

        const sites = await prisma.registeredSite.findMany({
            where,
            include: {
                webhook: {
                    select: {
                        id: true,
                        active: true,
                        dailyLimit: true,
                        maxDailyLimit: true,
                        growthRate: true,
                        categories: true,
                        _count: { select: { publishedArticles: true } },
                    },
                },
            },
            orderBy: { registeredAt: "desc" },
        });

        res.json({
            success: true,
            count: sites.length,
            sites,
        });
    } catch (error) {
        log.error("Failed to list sites", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/sites/:id
 * Get a single registered site by ID.
 */
router.get("/:id", async (req, res) => {
    try {
        await connectDB();

        const site = await prisma.registeredSite.findUnique({
            where: { id: req.params.id },
            include: {
                webhook: {
                    include: {
                        publishedArticles: {
                            orderBy: { publishedAt: "desc" },
                            take: 10,
                        },
                    },
                },
            },
        });

        if (!site) {
            return res.status(404).json({ success: false, error: "Site not found" });
        }

        res.json({ success: true, site });
    } catch (error) {
        log.error("Failed to get site", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/sites/:id/approve
 * Admin approves a pending site — activates its webhook and starts publishing.
 */
router.post("/:id/approve", async (req, res) => {
    try {
        await connectDB();

        const site = await prisma.registeredSite.findUnique({
            where: { id: req.params.id },
            include: { webhook: true },
        });

        if (!site) {
            return res.status(404).json({ success: false, error: "Site not found" });
        }

        if (site.status === "active") {
            return res.status(409).json({ success: false, error: "Site is already active." });
        }

        // Activate webhook + update site status atomically
        await prisma.$transaction([
            prisma.webhook.update({
                where: { id: site.webhookId },
                data: { active: true },
            }),
            prisma.registeredSite.update({
                where: { id: site.id },
                data: { status: "active", approvedAt: new Date() },
            }),
        ]);

        log.info("Site approved — publishing now active", {
            siteId: site.id,
            domain: site.domain,
            webhookId: site.webhookId,
        });

        res.json({
            success: true,
            message: `Site "${site.name}" approved. Publishing will begin on the next scheduler run.`,
            siteId: site.id,
            domain: site.domain,
        });
    } catch (error) {
        log.error("Failed to approve site", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/sites/:id/reject
 * Admin rejects a site — deactivates webhook and marks as rejected.
 */
router.post("/:id/reject", async (req, res) => {
    try {
        await connectDB();

        const site = await prisma.registeredSite.findUnique({
            where: { id: req.params.id },
        });

        if (!site) {
            return res.status(404).json({ success: false, error: "Site not found" });
        }

        await prisma.$transaction([
            prisma.webhook.update({
                where: { id: site.webhookId },
                data: { active: false },
            }),
            prisma.registeredSite.update({
                where: { id: site.id },
                data: { status: "rejected" },
            }),
        ]);

        log.info("Site rejected", { siteId: site.id, domain: site.domain });

        res.json({
            success: true,
            message: `Site "${site.name}" rejected.`,
        });
    } catch (error) {
        log.error("Failed to reject site", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/sites/:id
 * Fully unregister a site — removes RegisteredSite and its Webhook.
 */
router.delete("/:id", async (req, res) => {
    try {
        await connectDB();

        const site = await prisma.registeredSite.findUnique({
            where: { id: req.params.id },
        });

        if (!site) {
            return res.status(404).json({ success: false, error: "Site not found" });
        }

        // Deleting the webhook cascades to RegisteredSite and WebhookPublish
        await prisma.webhook.delete({ where: { id: site.webhookId } });

        log.info("Site unregistered", { siteId: site.id, domain: site.domain });

        res.json({
            success: true,
            message: `Site "${site.name}" has been unregistered and all publishing history removed.`,
        });
    } catch (error) {
        log.error("Failed to unregister site", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
