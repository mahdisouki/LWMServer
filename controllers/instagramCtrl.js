const { fetchInstagramPosts, refreshInstagramToken } = require('../services/instagramService');

const instagramCtrl = {
  // Get Instagram posts
  getInstagramPosts: async (req, res) => {
    try {
      const { limit = 10, after } = req.query;

      const result = await fetchInstagramPosts(parseInt(limit), after);

      res.status(200).json({
        message: 'Instagram posts retrieved successfully',
        posts: result.posts,
        paging: result.paging || null
      });
    } catch (error) {
      console.error('Error fetching Instagram posts:', error);
      res.status(500).json({
        message: 'Failed to retrieve Instagram posts',
        error: error.message
      });
    }
  },

  // Refresh Instagram long-lived token (manual endpoint)
  refreshLongLivedToken: async (req, res) => {
    try {
      const result = await refreshInstagramToken();

      res.status(200).json({
        message: 'Instagram token refreshed successfully',
        access_token: result.access_token,
        expires_in: result.expires_in,
        expiresAt: result.expiresAt
      });
    } catch (error) {
      console.error('❌ Failed to refresh Instagram token:', error.message);
      res.status(500).json({
        message: 'Failed to refresh Instagram token',
        error: error.message
      });
    }
  }





};

module.exports = instagramCtrl; 