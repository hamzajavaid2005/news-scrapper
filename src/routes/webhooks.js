import express from "express";
import { prisma, connectDB } from "../prisma.js";
import { log } from "../lib/logger.js";

const router = express.Router();

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
 * POST /api/webhooks
 * Create a new webhook
 *
 * Body:
 * {
 *   name: "My Blog",                    // Required
 *   url: "https://...",                 // Required
 *   active: true,                       // Optional (default: true)
 *   secret: "my-secret",                // Optional
 *   dailyLimit: 7,                      // Optional (default: 7)
 *   growthRate: 0.10,                   // Optional (default: 0.10)
 *   categories: ["Tech", "AI"]          // Optional (default: [])
 * }
 */
router.post("/", async (req, res) => {
    try {
        await connectDB();

        const {
            name,
            url,
            active,
            secret,
            dailyLimit,
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

        // Check if URL already exists
        const existing = await prisma.webhook.findUnique({ where: { url } });
        if (existing) {
            return res.status(409).json({
                success: false,
                error: "Webhook with this URL already exists",
            });
        }

        const webhook = await prisma.webhook.create({
            data: {
                name,
                url,
                active: active ?? true,
                secret: secret || null,
                dailyLimit: dailyLimit ?? 7,
                growthRate: growthRate ?? 0.1,
                categories: categories ?? [],
                publishStartDay: new Date(),
            },
        });

        log.info("Webhook created", {
            webhookId: webhook.id,
            name: webhook.name,
        });

        res.status(201).json({ success: true, webhook });
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

export default router;
