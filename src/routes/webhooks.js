import express from "express";
import { prisma, connectDB } from "../prisma.js";
import { log } from "../lib/logger.js";

// Admin secret is stored in .env as ADMIN_SECRET
// Any request with this secret bypasses all WordPress verification
const ADMIN_SECRET = process.env.ADMIN_SECRET || null;

const router = express.Router();

/**
 * Verify a WordPress endpoint running the News Automation plugin.
 * Calls the /health endpoint and checks auth + domain status.
 *
 * @param {string} webhookUrl - The webhook publish URL (e.g., https://site.com/wp-json/news-automation/v1/publish)
 * @param {string|null} secret - The webhook secret key
 * @returns {object} Verification result
 */
async function verifyWordPressEndpoint(webhookUrl, secret) {
    const result = {
        reachable: false,
        pluginInstalled: false,
        authorized: false,
        domainVerified: false,
        pluginVersion: null,
        whitelistCount: 0,
        hasDomainLock: false,
        error: null,
    };

    try {
        // Derive the health URL from the publish URL
        // /wp-json/news-automation/v1/publish → /wp-json/news-automation/v1/health
        const healthUrl = webhookUrl.replace(/\/publish\/?$/, '/health');

        const headers = { 'Content-Type': 'application/json' };
        if (secret) {
            headers['X-Webhook-Secret'] = secret;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const response = await fetch(healthUrl, {
            method: 'GET',
            headers,
            signal: controller.signal,
        });
        clearTimeout(timeout);

        result.reachable = true;

        if (!response.ok) {
            result.error = `HTTP ${response.status}: ${response.statusText}`;
            return result;
        }

        const data = await response.json();

        // Check if the response looks like our plugin
        if (data.status === 'ok' && data.version) {
            result.pluginInstalled = true;
            result.pluginVersion = data.version;
            result.authorized = data.auth === 'authorized';
            result.domainVerified = data.domain_check === 'verified';

            if (data.config) {
                result.hasDomainLock = data.config.has_domain_lock || false;
                result.whitelistCount = data.config.whitelist_count || 0;
            }
        } else {
            result.error = 'Endpoint responded but does not appear to be the News Automation plugin.';
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            result.error = 'Connection timed out after 10 seconds.';
        } else {
            result.error = err.message;
        }
    }

    return result;
}

/**
 * GET /api/webhooks
 * List all webhooks with stats
 */
router.get("/", async (req, res) => {
    try {
        await connectDB();

        const webhooks = await prisma.webhook.findMany({
            include: {
                _count: {
                    select: { publishedArticles: true },
                },
            },
            orderBy: { createdAt: "desc" },
        });

        // Calculate today's stats for each webhook
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const webhooksWithStats = await Promise.all(
            webhooks.map(async (webhook) => {
                const publishedToday = await prisma.webhookPublish.count({
                    where: {
                        webhookId: webhook.id,
                        publishedAt: { gte: todayStart },
                        status: "success",
                    },
                });

                // Calculate current daily quota
                const daysSinceStart = Math.floor(
                    (Date.now() - new Date(webhook.publishStartDay).getTime()) /
                        (24 * 60 * 60 * 1000)
                );
                const dailyQuota = Math.max(
                    Math.floor(
                        webhook.dailyLimit *
                            Math.pow(1 + webhook.growthRate, daysSinceStart)
                    ),
                    1
                );

                return {
                    ...webhook,
                    totalPublished: webhook._count.publishedArticles,
                    publishedToday,
                    dailyQuota,
                    remainingToday: Math.max(0, dailyQuota - publishedToday),
                };
            })
        );

        res.json({
            success: true,
            count: webhooksWithStats.length,
            webhooks: webhooksWithStats,
        });
    } catch (error) {
        log.error("Failed to list webhooks", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/webhooks/:id
 * Get a single webhook by ID
 */
router.get("/:id", async (req, res) => {
    try {
        await connectDB();

        const webhook = await prisma.webhook.findUnique({
            where: { id: req.params.id },
            include: {
                publishedArticles: {
                    orderBy: { publishedAt: "desc" },
                    take: 10,
                    include: {
                        generatedArticle: {
                            select: { title: true, category: true },
                        },
                    },
                },
            },
        });

        if (!webhook) {
            return res
                .status(404)
                .json({ success: false, error: "Webhook not found" });
        }

        res.json({ success: true, webhook });
    } catch (error) {
        log.error("Failed to get webhook", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/webhooks/verify-url
 * Pre-verify a WordPress endpoint before creating a webhook.
 * Useful for testing connection + secret before committing.
 *
 * Body: { url: "https://...", secret: "..." }
 */
router.post("/verify-url", async (req, res) => {
    try {
        const { url, secret } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, error: "url is required" });
        }

        log.info("Verifying WordPress endpoint", { url });

        const verification = await verifyWordPressEndpoint(url, secret || null);

        res.json({
            success: true,
            url,
            verification,
        });
    } catch (error) {
        log.error("Failed to verify URL", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/webhooks
 * Create a new webhook.
 *
 * ─── Mode 1: Admin Quick-Create (no plugin needed) ─────────────────────────
 * Send adminSecret in the body. If it matches ADMIN_SECRET in .env,
 * the webhook is created instantly, active:true, no verification.
 *
 * Body:
 * {
 *   adminSecret: "your-admin-secret",  // Required for instant creation
 *   name: "Wordpress Website",          // Required
 *   url: "https://...v1/publish",       // Required
 *   active: true,                       // Optional (default: true)
 *   secret: "webhook-secret",           // Optional — sent as X-Webhook-Secret
 *   dailyLimit: 900,                    // Optional (default: 7)
 *   maxDailyLimit: 1000,                // Optional (default: 50)
 *   growthRate: 0.10,                   // Optional (default: 0.10)
 *   categories: ["Pakistan", "World"]   // Optional (default: [])
 * }
 *
 * ─── Mode 2: WordPress Plugin Auto-Registration ────────────────────────────
 * No adminSecret — the plugin's /api/sites/register flow handles this.
 * WordPress endpoints are auto-verified via health check.
 */
router.post("/", async (req, res) => {
    try {
        await connectDB();

        const {
            adminSecret,
            name,
            url,
            active,
            secret,
            dailyLimit,
            maxDailyLimit,
            growthRate,
            categories,
        } = req.body;

        // Validation
        if (!name || !url) {
            return res.status(400).json({
                success: false,
                error: "name and url are required",
            });
        }

        // ── Admin Secret Verification ──────────────────────────────────────
        // If an adminSecret is provided, verify it and skip all other checks.
        const isAdminCreate = Boolean(adminSecret);

        if (isAdminCreate) {
            if (!ADMIN_SECRET) {
                return res.status(500).json({
                    success: false,
                    error: "ADMIN_SECRET is not configured on this server. Add it to your .env file.",
                });
            }
            if (adminSecret !== ADMIN_SECRET) {
                log.warn("Invalid adminSecret on webhook creation", { url });
                return res.status(401).json({
                    success: false,
                    error: "Invalid admin secret.",
                });
            }
        }

        // Check if URL already exists
        const existing = await prisma.webhook.findUnique({ where: { url } });
        if (existing) {
            return res.status(409).json({
                success: false,
                error: "Webhook with this URL already exists",
                webhookId: existing.id,
            });
        }

        // ── WordPress Verification (only for non-admin plugin-less creates) ─
        let verification = null;
        if (!isAdminCreate && url.includes('/wp-json/news-automation/')) {
            verification = await verifyWordPressEndpoint(url, secret || null);
            log.info("WordPress endpoint verification", { url, verification });
        }

        const webhook = await prisma.webhook.create({
            data: {
                name,
                url,
                active: active !== undefined ? Boolean(active) : true,
                secret: secret || null,
                dailyLimit: dailyLimit ?? 7,
                maxDailyLimit: maxDailyLimit ?? 50,
                growthRate: growthRate ?? 0.1,
                categories: categories ?? [],
                publishStartDay: new Date(),
            },
        });

        log.info("Webhook created", {
            webhookId: webhook.id,
            name: webhook.name,
            method: isAdminCreate ? "admin-secret" : "standard",
        });

        res.status(201).json({
            success: true,
            webhook,
            method: isAdminCreate ? "admin-secret" : "standard",
            verification: isAdminCreate ? null : verification,
        });
    } catch (error) {
        log.error("Failed to create webhook", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/webhooks/:id
 * Update an existing webhook
 */
router.put("/:id", async (req, res) => {
    try {
        await connectDB();

        const {
            name,
            url,
            active,
            secret,
            dailyLimit,
            maxDailyLimit,
            growthRate,
            categories,
        } = req.body;

        // Check if webhook exists
        const existing = await prisma.webhook.findUnique({
            where: { id: req.params.id },
        });

        if (!existing) {
            return res
                .status(404)
                .json({ success: false, error: "Webhook not found" });
        }

        // If changing URL, check it doesn't conflict with another webhook
        if (url && url !== existing.url) {
            const urlConflict = await prisma.webhook.findUnique({
                where: { url },
            });
            if (urlConflict) {
                return res.status(409).json({
                    success: false,
                    error: "Another webhook with this URL already exists",
                });
            }
        }

        const webhook = await prisma.webhook.update({
            where: { id: req.params.id },
            data: {
                ...(name !== undefined && { name }),
                ...(url !== undefined && { url }),
                ...(active !== undefined && { active }),
                ...(secret !== undefined && { secret: secret || null }),
                ...(dailyLimit !== undefined && { dailyLimit }),
                ...(maxDailyLimit !== undefined && { maxDailyLimit }),
                ...(growthRate !== undefined && { growthRate }),
                ...(categories !== undefined && { categories }),
            },
        });

        log.info("Webhook updated", {
            webhookId: webhook.id,
            name: webhook.name,
        });

        res.json({ success: true, webhook });
    } catch (error) {
        log.error("Failed to update webhook", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/webhooks/:id
 * Delete a webhook
 */
router.delete("/:id", async (req, res) => {
    try {
        await connectDB();

        const existing = await prisma.webhook.findUnique({
            where: { id: req.params.id },
        });

        if (!existing) {
            return res
                .status(404)
                .json({ success: false, error: "Webhook not found" });
        }

        await prisma.webhook.delete({
            where: { id: req.params.id },
        });

        log.info("Webhook deleted", {
            webhookId: req.params.id,
            name: existing.name,
        });

        res.json({ success: true, message: "Webhook deleted successfully" });
    } catch (error) {
        log.error("Failed to delete webhook", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/webhooks/:id/toggle
 * Toggle webhook active status
 */
router.post("/:id/toggle", async (req, res) => {
    try {
        await connectDB();

        const existing = await prisma.webhook.findUnique({
            where: { id: req.params.id },
        });

        if (!existing) {
            return res
                .status(404)
                .json({ success: false, error: "Webhook not found" });
        }

        const webhook = await prisma.webhook.update({
            where: { id: req.params.id },
            data: { active: !existing.active },
        });

        log.info("Webhook toggled", {
            webhookId: webhook.id,
            active: webhook.active,
        });

        res.json({
            success: true,
            webhook,
            message: `Webhook ${webhook.active ? "enabled" : "disabled"}`,
        });
    } catch (error) {
        log.error("Failed to toggle webhook", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/webhooks/:id/reset-quota
 * Reset the publish start day to today (resets growth calculation)
 */
router.post("/:id/reset-quota", async (req, res) => {
    try {
        await connectDB();

        const webhook = await prisma.webhook.update({
            where: { id: req.params.id },
            data: {
                publishStartDay: new Date(),
                lastCategoryIndex: 0,
            },
        });

        log.info("Webhook quota reset", { webhookId: webhook.id });

        res.json({
            success: true,
            webhook,
            message: "Quota and category rotation reset to day 0",
        });
    } catch (error) {
        log.error("Failed to reset webhook quota", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/webhooks/:id/history
 * Get publishing history for a webhook
 */
router.get("/:id/history", async (req, res) => {
    try {
        await connectDB();

        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        const [history, total] = await Promise.all([
            prisma.webhookPublish.findMany({
                where: { webhookId: req.params.id },
                orderBy: { publishedAt: "desc" },
                take: limit,
                skip: offset,
                include: {
                    generatedArticle: {
                        select: {
                            title: true,
                            category: true,
                            articleId: true,
                        },
                    },
                },
            }),
            prisma.webhookPublish.count({
                where: { webhookId: req.params.id },
            }),
        ]);

        res.json({
            success: true,
            total,
            limit,
            offset,
            history,
        });
    } catch (error) {
        log.error("Failed to get webhook history", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/webhooks/:id/verify
 * Verify an existing webhook's WordPress connection.
 * Calls the plugin's /health endpoint to check:
 *  - Is the site reachable?
 *  - Is the plugin installed?
 *  - Is the secret key authorized?
 *  - Is the domain lock verified?
 *  - How many categories are whitelisted?
 */
router.post("/:id/verify", async (req, res) => {
    try {
        await connectDB();

        const webhook = await prisma.webhook.findUnique({
            where: { id: req.params.id },
        });

        if (!webhook) {
            return res
                .status(404)
                .json({ success: false, error: "Webhook not found" });
        }

        const verification = await verifyWordPressEndpoint(
            webhook.url,
            webhook.secret
        );

        log.info("WordPress endpoint verified", {
            webhookId: webhook.id,
            name: webhook.name,
            verification,
        });

        res.json({
            success: true,
            webhook: {
                id: webhook.id,
                name: webhook.name,
                url: webhook.url,
            },
            verification,
        });
    } catch (error) {
        log.error("Failed to verify webhook", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/webhooks/verify-all
 * Verify ALL active webhooks at once.
 * Returns a summary of which are healthy and which have issues.
 */
router.post("/verify-all", async (req, res) => {
    try {
        await connectDB();

        const webhooks = await prisma.webhook.findMany({
            where: { active: true },
        });

        if (webhooks.length === 0) {
            return res.json({
                success: true,
                message: "No active webhooks to verify",
                results: [],
            });
        }

        const results = await Promise.all(
            webhooks.map(async (webhook) => {
                const verification = await verifyWordPressEndpoint(
                    webhook.url,
                    webhook.secret
                );
                return {
                    id: webhook.id,
                    name: webhook.name,
                    url: webhook.url,
                    healthy:
                        verification.reachable &&
                        verification.pluginInstalled &&
                        verification.authorized,
                    verification,
                };
            })
        );

        const healthy = results.filter((r) => r.healthy).length;
        const unhealthy = results.filter((r) => !r.healthy).length;

        log.info("Bulk webhook verification", { total: results.length, healthy, unhealthy });

        res.json({
            success: true,
            summary: {
                total: results.length,
                healthy,
                unhealthy,
            },
            results,
        });
    } catch (error) {
        log.error("Failed to verify all webhooks", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
