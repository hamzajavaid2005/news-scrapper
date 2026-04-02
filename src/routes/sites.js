import express from "express";
import { prisma, connectDB } from "../prisma.js";
import { log } from "../lib/logger.js";
import crypto from "crypto";

const router = express.Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Generate a secure random hex string of given byte length */
function generateKey(bytes = 32) {
    return crypto.randomBytes(bytes).toString("hex");
}

/**
 * Verify a WordPress registration token by calling back to the WP site.
 * Core security check — scrapper calls WordPress, not the other way.
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

        if (!data.secret || !data.domain) {
            result.error = "Invalid response from WordPress — plugin may not be installed correctly.";
            return result;
        }

        // Domain binding — response domain must match request domain
        const reportedDomain = data.domain.replace(/\/$/, "").toLowerCase();
        const requestedDomain = domain.replace(/\/$/, "").toLowerCase();

        if (reportedDomain !== requestedDomain) {
            result.error = `Domain mismatch: request said "${requestedDomain}" but WordPress reports "${reportedDomain}".`;
            return result;
        }

        result.valid        = true;
        result.secret       = data.secret;
        result.categories   = data.categories   || [];
        result.dailyLimit   = data.dailyLimit   || 7;
        result.maxDailyLimit = data.maxDailyLimit || 50;
        result.growthRate   = data.growthRate   || 0.1;
        result.pluginVersion = data.version     || null;
    } catch (err) {
        result.error = err.name === "AbortError"
            ? "Connection to WordPress timed out after 10 seconds."
            : err.message;
    }

    return result;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/sites/register
 *
 * WordPress plugin "Connect" button triggers this.
 * Verifies token, creates a PENDING webhook and registered site.
 * Returns siteId + apiKey (used for status checks and settings sync).
 *
 * Body: { name, domain, token }
 * Plugin settings (categories, dailyLimit, etc.) are pulled from WordPress
 * via the token verification callback.
 */
router.post("/register", async (req, res) => {
    try {
        await connectDB();

        const { name, domain, token } = req.body;

        if (!name || !domain || !token) {
            return res.status(400).json({
                success: false,
                error: "name, domain, and token are required.",
            });
        }

        const normalizedDomain = domain.replace(/\/$/, "").toLowerCase();

        if (!token.startsWith("naw_reg_")) {
            return res.status(400).json({
                success: false,
                error: "Invalid token format. Must be a News Automation registration token.",
            });
        }

        // Check for duplicate domain
        const existingSite = await prisma.registeredSite.findUnique({
            where: { domain: normalizedDomain },
        });

        if (existingSite) {
            // Domain already registered — verify token to prove ownership, then return credentials
            log.info("Re-registration attempt for existing domain — verifying token", { domain: normalizedDomain });
            const reVerify = await verifyRegistrationToken(normalizedDomain, token);
            if (!reVerify.valid) {
                return res.status(409).json({
                    success: false,
                    error: `Domain "${normalizedDomain}" is already registered. Token verification failed: ${reVerify.error}`,
                    siteId: existingSite.id,
                    status: existingSite.status,
                });
            }

            // Token verified — site owner is re-linking. Update webhook settings and return credentials.
            await prisma.webhook.update({
                where: { id: existingSite.webhookId },
                data: {
                    secret: reVerify.secret,
                    categories: reVerify.categories,
                    dailyLimit: reVerify.dailyLimit,
                    growthRate: reVerify.growthRate,
                },
            });

            log.info("Existing site re-linked successfully", {
                siteId: existingSite.id,
                domain: normalizedDomain,
            });

            return res.status(200).json({
                success: true,
                status: existingSite.status,
                siteId: existingSite.id,
                apiKey: existingSite.apiKey,
                message: "Site re-linked. Your existing credentials have been restored.",
                relinked: true,
            });
        }

        // Verify token by calling WordPress back
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

        const publishUrl = `${normalizedDomain}/wp-json/news-automation/v1/publish`;

        // Check webhook URL not already taken
        const existingWebhook = await prisma.webhook.findUnique({
            where: { url: publishUrl },
        });
        if (existingWebhook) {
            return res.status(409).json({
                success: false,
                error: "A webhook for this URL already exists.",
            });
        }

        // Generate per-site API key (for settings sync auth)
        const apiKey    = generateKey(32);
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

        // Create webhook (active: false — requires admin approval)
        const webhook = await prisma.webhook.create({
            data: {
                name,
                url: publishUrl,
                active: false,
                secret: verification.secret,
                dailyLimit: verification.dailyLimit,
                maxDailyLimit: verification.maxDailyLimit,
                growthRate: verification.growthRate,
                categories: verification.categories,
                publishStartDay: new Date(),
            },
        });

        // Create RegisteredSite record
        const site = await prisma.registeredSite.create({
            data: {
                domain: normalizedDomain,
                name,
                tokenHash,
                apiKey,
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
            apiKey,                          // Plugin stores this for future auth
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
 * GET /api/sites/status?siteId=&apiKey=
 *
 * Plugin polls this to check approval status.
 * Returns pending | active (never returns "rejected" — shows "pending" to user).
 */
router.get("/status", async (req, res) => {
    try {
        await connectDB();

        const { siteId, apiKey } = req.query;

        if (!siteId || !apiKey) {
            return res.status(400).json({
                success: false,
                error: "siteId and apiKey are required.",
            });
        }

        const site = await prisma.registeredSite.findUnique({
            where: { id: siteId },
            include: {
                webhook: {
                    select: {
                        id: true,
                        active: true,
                        dailyLimit: true,
                        maxDailyLimit: true,
                        growthRate: true,
                        categories: true,
                    },
                },
            },
        });

        // Not found OR wrong apiKey → same response (security: don't reveal site exists)
        if (!site || site.apiKey !== apiKey) {
            return res.status(404).json({
                success: false,
                error: "Site not found or invalid API key.",
            });
        }

        // Map "rejected" → "pending" so site owners don't see rejection
        const visibleStatus = site.status === "rejected" ? "pending" : site.status;

        return res.json({
            success: true,
            status: visibleStatus,
            approved: site.status === "active",
            domain: site.domain,
            webhook: site.status === "active" ? site.webhook : null,
        });
    } catch (error) {
        log.error("Failed to get site status", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/sites
 * List all registered sites. Add ?status=pending to filter.
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

        res.json({ success: true, count: sites.length, sites });
    } catch (error) {
        log.error("Failed to list sites", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/sites/:id
 * Get a single site by ID.
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
 * Admin approves a pending site — activates webhook, starts publishing.
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
 * Admin rejects a site.
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
        res.json({ success: true, message: `Site "${site.name}" rejected.` });
    } catch (error) {
        log.error("Failed to reject site", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/sites/:id/settings
 *
 * Plugin syncs settings to scrapper after approval.
 * Authenticated with per-site API key (X-Plugin-Api-Key header).
 *
 * Allows updating: categories, dailyLimit, growthRate
 * Does NOT allow changing: maxDailyLimit (admin-controlled ceiling)
 * dailyLimit is auto-capped at maxDailyLimit.
 */
router.put("/:id/settings", async (req, res) => {
    try {
        await connectDB();

        const apiKey = req.headers["x-plugin-api-key"];
        const webhookSecret = req.headers["x-webhook-secret"];

        if (!apiKey && !webhookSecret) {
            return res.status(401).json({
                success: false,
                error: "Missing authentication. Provide X-Plugin-Api-Key or X-Webhook-Secret header.",
            });
        }

        const site = await prisma.registeredSite.findUnique({
            where: { id: req.params.id },
            include: { webhook: true },
        });

        if (!site) {
            return res.status(401).json({
                success: false,
                error: "Invalid site ID.",
            });
        }

        // Authenticate: api key (preferred) or webhook secret (fallback for v1.x upgrades)
        const authenticated = apiKey
            ? site.apiKey === apiKey
            : site.webhook && site.webhook.secret === webhookSecret;

        if (!authenticated) {
            return res.status(401).json({
                success: false,
                error: "Invalid credentials.",
            });
        }

        if (site.status !== "active") {
            return res.status(403).json({
                success: false,
                error: "Site is not yet approved. Settings sync is only available after approval.",
            });
        }

        const { categories, dailyLimit, growthRate } = req.body;

        // Build update — only include fields that were sent
        const updatedData = {};

        if (categories !== undefined) {
            if (!Array.isArray(categories)) {
                return res.status(400).json({ success: false, error: "categories must be an array." });
            }
            updatedData.categories = categories;
        }

        if (growthRate !== undefined) {
            updatedData.growthRate = Math.max(0, Math.min(1, parseFloat(growthRate)));
        }

        if (dailyLimit !== undefined) {
            const requested = parseInt(dailyLimit);
            // Cap at the maxDailyLimit set by admin — site owner cannot exceed this
            updatedData.dailyLimit = Math.min(requested, site.webhook.maxDailyLimit);
        }

        if (Object.keys(updatedData).length === 0) {
            return res.status(400).json({
                success: false,
                error: "No valid fields provided to update. Allowed: categories, dailyLimit, growthRate.",
            });
        }

        const updatedWebhook = await prisma.webhook.update({
            where: { id: site.webhookId },
            data: updatedData,
        });

        log.info("Plugin synced settings", {
            siteId: site.id,
            domain: site.domain,
            updated: updatedData,
        });

        res.json({
            success: true,
            message: "Settings updated successfully.",
            webhook: {
                categories: updatedWebhook.categories,
                dailyLimit: updatedWebhook.dailyLimit,
                maxDailyLimit: updatedWebhook.maxDailyLimit,
                growthRate: updatedWebhook.growthRate,
            },
        });
    } catch (error) {
        log.error("Failed to sync site settings", error);
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
