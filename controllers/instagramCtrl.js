const { fetchInstagramPosts, refreshInstagramToken } = require('../services/instagramService');

/** Strip Graph secrets / URLs from any string sent to clients or logs. */
function redactSecrets(value) {
  if (value == null) return value;
  const text = typeof value === 'string' ? value : String(value);
  return text
    .replace(/access_token=[^&\s"'\\]*/gi, 'access_token=[REDACTED]')
    .replace(/https?:\/\/graph\.facebook\.com[^\s"'\\]*/gi, '[REDACTED_GRAPH_URL]');
}

function sanitizeChildMedia(child) {
  if (!child || typeof child !== 'object') return null;
  return {
    id: child.id,
    media_type: child.media_type,
    media_url: child.media_url,
  };
}

function sanitizePost(post) {
  if (!post || typeof post !== 'object') return null;
  const sanitized = {
    id: post.id,
    caption: post.caption,
    media_type: post.media_type,
    media_url: post.media_url,
    permalink: post.permalink,
    timestamp: post.timestamp,
    like_count: post.like_count,
    comments_count: post.comments_count,
  };
  if (Array.isArray(post.children)) {
    sanitized.children = post.children.map(sanitizeChildMedia).filter(Boolean);
  }
  return sanitized;
}

const instagramCtrl = {
  // Get Instagram posts (public) — never forward Graph paging / tokens
  getInstagramPosts: async (req, res) => {
    try {
      const { limit = 10, after } = req.query;

      const result = await fetchInstagramPosts(parseInt(limit, 10), after);
      const posts = (result.posts || []).map(sanitizePost).filter(Boolean);

      res.status(200).json({
        message: 'Instagram posts retrieved successfully',
        posts,
      });
    } catch (error) {
      const safeMessage = redactSecrets(error.message);
      console.error('Error fetching Instagram posts:', safeMessage);
      res.status(500).json({
        message: 'Failed to retrieve Instagram posts',
        error: safeMessage,
      });
    }
  },

  // Manual token refresh (auth) — do not return the new access_token to the client
  refreshLongLivedToken: async (req, res) => {
    try {
      const result = await refreshInstagramToken();

      res.status(200).json({
        message: 'Instagram token refreshed successfully',
        expires_in: result.expires_in,
        expiresAt: result.expiresAt,
      });
    } catch (error) {
      const safeMessage = redactSecrets(error.message);
      console.error('❌ Failed to refresh Instagram token:', safeMessage);
      res.status(500).json({
        message: 'Failed to refresh Instagram token',
        error: safeMessage,
      });
    }
  },
};

module.exports = instagramCtrl;
