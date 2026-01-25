const InstagramToken = require('../models/InstagramToken');

const IG_BUSINESS_ID = process.env.IG_BUSINESS_ID || '17841421517842524';
const IG_APP_ID = process.env.IG_APP_ID || '998225742492123';
const IG_APP_SECRET = process.env.IG_APP_SECRET || '587d3bd9244e94ca80ca254093ce9405';

/**
 * Get Instagram access token from database
 * Falls back to environment variable if not in DB
 */
async function getInstagramToken() {
  try {
    const tokenDoc = await InstagramToken.findOne({ platform: 'instagram' });
    if (tokenDoc && tokenDoc.token) {
      return tokenDoc.token;
    }
    // Fallback to env variable
    return process.env.IG_TOKEN;
  } catch (error) {
    console.error('Error getting Instagram token:', error);
    return process.env.IG_TOKEN;
  }
}

/**
 * Fetch Instagram posts from Graph API
 */
async function fetchInstagramPosts(limit = 10, after = null) {
  try {
    const token = await getInstagramToken();
    if (!token) {
      throw new Error('Instagram access token not found');
    }

    let url = `https://graph.facebook.com/v24.0/${IG_BUSINESS_ID}/media?fields=id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count&access_token=${token}&limit=${limit}`;
    
    if (after) {
      url += `&after=${after}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      throw new Error(`Instagram API error: ${JSON.stringify(data.error)}`);
    }

    return {
      posts: data.data || [],
      paging: data.paging || null
    };
  } catch (error) {
    console.error('Error fetching Instagram posts:', error);
    throw error;
  }
}

/**
 * Refresh Instagram long-lived token
 * Should be called every 30 days before 60-day expiration
 */
async function refreshInstagramToken() {
  try {
    // Get current token from DB
    let tokenDoc = await InstagramToken.findOne({ platform: 'instagram' });
    
    if (!tokenDoc) {
      // If no token in DB, try to create one from env variable
      const envToken = process.env.IG_TOKEN;
      if (!envToken) {
        throw new Error('No Instagram token found in database or environment variables');
      }
      tokenDoc = new InstagramToken({
        platform: 'instagram',
        token: envToken
      });
    }

    const currentToken = tokenDoc.token;

    // Refresh token via FB Graph API
    const url = `https://graph.facebook.com/v24.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${IG_APP_ID}&client_secret=${IG_APP_SECRET}&fb_exchange_token=${currentToken}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      throw new Error(`Token refresh error: ${JSON.stringify(data.error)}`);
    }

    // Calculate expiration date (expires_in is in seconds)
    const expiresAt = data.expires_in 
      ? new Date(Date.now() + (data.expires_in * 1000))
      : null;

    // Update token in database
    tokenDoc.token = data.access_token;
    tokenDoc.expiresAt = expiresAt;
    tokenDoc.updatedAt = new Date();
    await tokenDoc.save();

    console.log('✅ Instagram token refreshed successfully');
    console.log(`   Token expires in: ${data.expires_in ? Math.floor(data.expires_in / 86400) : 'unknown'} days`);

    return {
      access_token: data.access_token,
      expires_in: data.expires_in,
      expiresAt: expiresAt
    };
  } catch (error) {
    console.error('❌ Failed to refresh Instagram token:', error.message);
    throw error;
  }
}

module.exports = {
  getInstagramToken,
  fetchInstagramPosts,
  refreshInstagramToken
};
