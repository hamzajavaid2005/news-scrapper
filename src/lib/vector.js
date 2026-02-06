import { prisma } from "../prisma.js";

/**
 * Find similar articles based on vector similarity
 * @param {Array<number>} embedding - 1536-dimensional vector
 * @param {number} threshold - Similarity threshold (0-1, default 0.85)
 * @param {string} excludeId - Article ID to exclude from results (to avoid self-matching)
 * @returns {Promise<Array>} - List of similar articles
 */
export async function findSimilarArticles(
    embedding,
    threshold = 0.85,
    excludeId = null
) {
    // Use Prisma's raw query to leverage pgvector operators
    // <=> is cosine distance. 1 - distance = similarity.
    // We want similarity > threshold, so distance < 1 - threshold
    const distanceThreshold = 1 - threshold;

    // Convert embedding array to vector string format for SQL
    const vectorString = `[${embedding.join(",")}]`;

    try {
        // Exclude the current article to prevent self-matching
        const articles = await prisma.$queryRaw`
      SELECT a.id, a.title, a.url, s.name as "sourceName", 1 - (a.embedding <=> ${vectorString}::vector) as similarity
      FROM articles a
      LEFT JOIN sources s ON a."sourceId" = s.id
      WHERE a.id != ${excludeId}
        AND 1 - (a.embedding <=> ${vectorString}::vector) > ${threshold}
      ORDER BY similarity DESC
      LIMIT 1;
    `;

        return articles;
    } catch (error) {
        console.error("Vector search error:", error);
        return [];
    }
}
