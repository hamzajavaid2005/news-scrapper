/**
 * Category-Based Writing Styles
 * 
 * Each style defines how the AI should write articles for specific categories.
 * Styles are matched against the article's RSS category.
 */

const WRITING_STYLES = {
  // === HARD NEWS (AP Style) ===
  hardNews: {
    categories: [
      'Latest News', 'Breaking News', 'Pakistan', 'World', 'Politics',
      'Crime', 'Security', 'Elections', 'Governance', 'Law',
      'Human Rights', 'Immigration', 'Public Policy',
      'Asia', 'Middle East', 'Europe', 'Africa', 'Americas', 'UK', 'US', 'India', 'China'
    ],
    instructions: `Write in a STRAIGHT NEWS style (AP/Reuters style):
- Use the inverted pyramid structure: most important facts in the first paragraph
- Lead with "Who, What, When, Where, Why" in the opening sentence
- Keep sentences short and direct (15-25 words per sentence)
- Use active voice ("The government announced" NOT "It was announced by the government")
- Remain completely objective — no opinions, no adjectives that suggest bias
- Use past tense for events that already happened
- Each paragraph should cover one key point
- End with background context or what happens next`
  },

  // === BUSINESS & FINANCE ===
  business: {
    categories: [
      'Business', 'Economy', 'Markets', 'Real Estate', 'Agriculture'
    ],
    instructions: `Write in a PROFESSIONAL BUSINESS style:
- Lead with the key financial/business development and its impact
- Include specific numbers, percentages, and data points from the original
- Explain what the development means for businesses, consumers, or the economy
- Use precise financial language but keep it accessible to general readers
- Structure: development → context → impact → outlook
- Avoid sensationalism — let the numbers tell the story
- Use phrases like "recorded a growth of", "declined by", "projected to reach"`
  },

  // === SPORTS ===
  sports: {
    categories: ['Sports'],
    instructions: `Write in a DYNAMIC SPORTS REPORTING style:
- Open with the key result, score, or highlight moment
- Use vivid, action-oriented language ("smashed", "clinched", "dominated", "edged past")
- Include specific scores, statistics, and player performances
- Build momentum and excitement through the narrative
- Cover: result → key moments → standout performers → what's next
- Use present tense for dramatic effect where appropriate ("He strikes and the ball flies...")
- End with upcoming fixtures or tournament implications`
  },

  // === ENTERTAINMENT ===
  entertainment: {
    categories: [
      'Entertainment', 'Bollywood', 'Hollywood', 'Celebrities',
      'Movies', 'Music', 'K-Pop', 'Royals'
    ],
    instructions: `Write in an ENGAGING ENTERTAINMENT style:
- Open with a compelling hook that grabs attention
- Use a conversational yet professional tone
- Focus on the story behind the news — the drama, the significance
- Include relevant details about the people involved
- Keep it lively and interesting without being tabloid or gossipy
- Structure: hook → main story → details → reaction/significance
- Use descriptive language to paint a picture for the reader`
  },

  // === LIFESTYLE ===
  lifestyle: {
    categories: [
      'Lifestyle', 'Beauty', 'Fashion', 'Food', 'Horoscope',
      'Parenting', 'Relationships', 'Wellness', 'Travel'
    ],
    instructions: `Write in a WARM LIFESTYLE/FEATURE style:
- Open with a relatable angle that connects with the reader
- Use a friendly, approachable tone — like talking to a well-informed friend
- Focus on practical takeaways and why this matters to the reader's life
- Include sensory details where relevant (sights, tastes, experiences)
- Structure: engaging opening → main content → practical insights → takeaway
- Use "you" sparingly but make the reader feel included
- Keep paragraphs light and easy to read`
  },

  // === SCIENCE & TECHNOLOGY ===
  sciTech: {
    categories: [
      'Technology', 'Science', 'Space', 'Innovation',
      'Artificial Intelligence', 'Cybersecurity', 'Gadgets', 'Digital',
      'Automobiles', 'Energy'
    ],
    instructions: `Write in a CLEAR TECH/SCIENCE EXPLAINER style:
- Lead with what happened and why it matters
- Explain complex concepts in simple, accessible language
- Use analogies to make technical topics relatable
- Focus on the real-world impact and implications
- Structure: discovery/development → how it works (simplified) → impact → future implications
- Avoid excessive jargon — if a technical term is needed, explain it briefly
- Convey a sense of progress and innovation`
  },

  // === HEALTH ===
  health: {
    categories: ['Health'],
    instructions: `Write in an AUTHORITATIVE HEALTH REPORTING style:
- Lead with the key health finding or development
- Present medical information clearly and accurately
- Explain what this means for the general public
- Include relevant context about conditions, treatments, or research
- Structure: key finding → details → expert context → practical implications
- Use precise medical terms but always explain them
- Avoid causing unnecessary alarm — present facts in measured tones
- Do NOT give direct medical advice`
  },

  // === ENVIRONMENT & CLIMATE ===
  climate: {
    categories: ['Climate', 'Environment', 'Weather'],
    instructions: `Write in an IMPACTFUL ENVIRONMENTAL style:
- Lead with the key environmental development or finding
- Use data and evidence to support the story
- Explain the broader impact on communities, ecosystems, or the planet
- Connect local events to larger environmental trends where relevant
- Structure: development → evidence/data → impact → response/outlook
- Present facts without excessive alarmism but don't downplay significance
- Use clear, measured language that conveys urgency through facts`
  },

  // === CULTURE & ARTS ===
  culture: {
    categories: ['Culture', 'Arts', 'Religion', 'History', 'Society', 'Education'],
    instructions: `Write in a THOUGHTFUL CULTURAL style:
- Open with the cultural significance or human angle
- Use rich, descriptive language to bring cultural topics to life
- Provide relevant historical or social context
- Explore why this matters to society and cultural identity
- Structure: cultural hook → main story → context → significance
- Maintain respect and sensitivity toward cultural and religious topics
- Balance information with storytelling`
  },

  // === OPINION / EDITORIAL ===
  opinion: {
    categories: ['Opinion', 'Investigations', 'Special Reports', 'Explainers', 'Interviews'],
    instructions: `Write in an ANALYTICAL / IN-DEPTH style:
- Lead with the central argument or key insight
- Present a clear, well-structured analysis of the topic
- Support points with evidence and specific examples from the content
- Explore multiple angles and implications
- Structure: thesis → supporting evidence → counterpoints → conclusion
- Use authoritative but accessible language
- End with a forward-looking perspective or key takeaway`
  },

  // === TRENDING / VIRAL ===
  trending: {
    categories: ['Trending'],
    instructions: `Write in a PUNCHY, ENGAGING style:
- Open with the most surprising or attention-grabbing element
- Keep the energy high and the pace fast
- Use short, impactful sentences
- Focus on what makes this story interesting, unusual, or shareable
- Structure: hook → the story → why it's trending → reactions
- Keep it fun and readable without being clickbait
- End with a memorable line or observation`
  }
};

/**
 * Get the writing style instructions for a given category.
 * Falls back to hardNews style if no match found.
 * 
 * @param {string|null} category - The RSS category of the article
 * @returns {{ styleName: string, instructions: string }}
 */
export function getWritingStyle(category) {
  if (!category) {
    return { styleName: 'hardNews', instructions: WRITING_STYLES.hardNews.instructions };
  }

  const categoryLower = category.toLowerCase();

  for (const [styleName, style] of Object.entries(WRITING_STYLES)) {
    if (style.categories.some(cat => cat.toLowerCase() === categoryLower)) {
      return { styleName, instructions: style.instructions };
    }
  }

  // Default to hard news style
  return { styleName: 'hardNews', instructions: WRITING_STYLES.hardNews.instructions };
}

export { WRITING_STYLES };
