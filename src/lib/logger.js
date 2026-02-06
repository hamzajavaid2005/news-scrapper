import pino from "pino";

/**
 * Pino Logger with Axiom Integration
 *
 * Centralized logging that sends to both:
 * - Console (for local debugging, prettified in dev)
 * - Axiom dashboard (for production monitoring)
 *
 * Environment Variables:
 * - AXIOM_TOKEN: Your Axiom API token
 * - AXIOM_DATASET: Dataset name in Axiom (e.g., "news-scrapper")
 */

// Check if Axiom is configured
const isAxiomConfigured = !!(
    process.env.AXIOM_TOKEN && process.env.AXIOM_DATASET
);

// Build transports array
const transports = [];

// Add console transport (pretty print for development)
transports.push({
    target: "pino-pretty",
    options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
    },
});

// Add Axiom transport if configured
if (isAxiomConfigured) {
    transports.push({
        target: "@axiomhq/pino",
        options: {
            dataset: process.env.AXIOM_DATASET,
            token: process.env.AXIOM_TOKEN,
        },
    });
}

// Create base logger
const baseLogger = pino(
    {
        level: process.env.LOG_LEVEL || "info",
        base: {
            service: "news-scrapper",
            env: process.env.NODE_ENV || "development",
        },
    },
    pino.transport({
        targets: transports,
    })
);

// Export the base logger
export const logger = baseLogger;

// Helper functions for structured logging
export const log = {
    // Info level - general information
    info: (message, data = {}) => {
        logger.info(data, message);
    },

    // Success - completed actions
    success: (message, data = {}) => {
        logger.info({ ...data, level: "success" }, `✓ ${message}`);
    },

    // Warning - non-critical issues
    warn: (message, data = {}) => {
        logger.warn(data, message);
    },

    // Error - failures
    error: (message, error = null, data = {}) => {
        logger.error(
            {
                ...data,
                error: error?.message || error,
                stack: error?.stack,
            },
            message
        );
    },

    // Debug - detailed debugging info
    debug: (message, data = {}) => {
        logger.debug(data, message);
    },

    // Pipeline events - for tracking article flow
    pipeline: (stage, articleId, message, data = {}) => {
        logger.info(
            {
                stage,
                articleId,
                type: "pipeline",
                ...data,
            },
            `[${stage}] ${message}`
        );
    },

    // RSS events
    rss: (sourceName, message, data = {}) => {
        logger.info(
            {
                source: sourceName,
                type: "rss",
                ...data,
            },
            `📡 [${sourceName}] ${message}`
        );
    },

    // AI Generation events
    ai: (action, message, data = {}) => {
        logger.info(
            {
                action,
                type: "ai",
                ...data,
            },
            `🤖 [${action}] ${message}`
        );
    },

    // Webhook events
    webhook: (webhookName, message, data = {}) => {
        logger.info(
            {
                webhook: webhookName,
                type: "webhook",
                ...data,
            },
            `📤 [${webhookName}] ${message}`
        );
    },
};

// Flush logs (Pino handles this automatically, but keeping for API compatibility)
export const flushLogs = async () => {
    // Pino auto-flushes, no action needed
    return Promise.resolve();
};

// Export status check
export { isAxiomConfigured };
