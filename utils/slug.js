// Utility functions for generating and normalizing slugs

/**
 * Normalize arbitrary text to a URL-safe slug.
 *
 * Examples:
 *  - "King / Queen Bed Base (Divan)" -> "king-queen-bed-base-divan"
 *  - "Environment‌ and‌ personal‌ responsibility‌" -> "environment-and-personal-responsibility"
 */
const normalizeToSlug = (text) => {
    if (!text) return '';

    return text
        .toString()
        // Normalize accents (é → e, etc.)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        // Normalize all quotes/apostrophes
        .replace(/['’“”"`´]/g, '')
        // Treat + as "and" for more human-friendly slugs
        .replace(/\+/g, ' and ')
        // Treat slashes, pipes, brackets, colons, ampersands, and most punctuation as separators
        .replace(/[/\\|,;!?.(){}\[\]<>&:\u2013\u2014]/g, ' ')
        // Turn any run of non-alphanumeric into a single hyphen
        .replace(/[^a-z0-9]+/g, '-')
        // Collapse multiple hyphens
        .replace(/-+/g, '-')
        // Trim leading/trailing hyphens
        .replace(/^-+|-+$/g, '');
};

/**
 * Normalize text for *comparison* between a slug and a title/name.
 *
 * This strips *all* non-alphanumeric characters so that variations like:
 *  - "Vacuums/Hoovers"
 *  - "vacuums-hoovers"
 *  - "Vacuums Hoovers"
 *  all compare equal to "vacuumshoovers".
 */
const normalizeForSlugCompare = (text) => {
    if (!text) return '';

    return text
        .toString()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
};

module.exports = {
    normalizeToSlug,
    normalizeForSlugCompare,
};



