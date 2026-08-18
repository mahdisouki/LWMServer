const InstagramToken = require('../models/InstagramToken');
const cloudinary = require('../helper/cloudinaryConfig');

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
 * Upload media from Instagram URL to Cloudinary
 * Uses Instagram post ID as public_id to avoid duplicate uploads
 */
async function uploadMediaToCloudinary(mediaUrl, mediaType, postId) {
  try {
    // Determine resource type based on media type
    const resourceType = mediaType === 'VIDEO' ? 'video' : 'image';

    // Use Instagram post ID as public_id (deterministic - same post = same Cloudinary asset)
    // Full public_id will be: instagram/{postId}
    const publicId = `instagram/${postId}`;

    // Check if asset already exists in Cloudinary
    try {
      const existingAsset = await cloudinary.api.resource(publicId, {
        resource_type: resourceType
      });

      // Asset exists, return existing URL
      return existingAsset.secure_url;
    } catch (apiError) {
      // Asset doesn't exist (404), proceed with upload
      if (apiError.http_code !== 404) {
        // Some other error occurred, log it but continue with upload attempt
        console.warn(`Error checking existing Cloudinary asset for ${publicId}:`, apiError.message);
      }
    }

    // Upload options with optimizations
    const uploadOptions = {
      resource_type: resourceType,
      public_id: publicId, // Full path: instagram/{postId}
      overwrite: false, // Don't overwrite if somehow it exists
      quality: 'auto:good',
      fetch_format: resourceType === 'image' ? 'auto' : undefined, // WebP/AVIF for images
      flags: resourceType === 'image' ? 'progressive' : undefined, // Progressive JPEG
    };

    // Upload from Instagram URL
    const result = await cloudinary.uploader.upload(mediaUrl, uploadOptions);

    return result.secure_url;
  } catch (error) {
    console.error(`Error uploading media to Cloudinary (${mediaUrl}):`, error.message);
    // Return original URL if Cloudinary upload fails
    return mediaUrl;
  }
}

/**
 * Fetch children media for CAROUSEL_ALBUM posts
 */
async function fetchChildrenMedia(mediaId, token) {
  try {
    const url = `https://graph.facebook.com/v24.0/${mediaId}/children?fields=id,media_type,media_url&access_token=${token}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      console.error(`Error fetching children media for ${mediaId}:`, data.error);
      return [];
    }

    return data.data || [];
  } catch (error) {
    console.error(`Error fetching children media for ${mediaId}:`, error.message);
    return [];
  }
}

/**
 * Process Instagram post media and upload to Cloudinary
 */
async function processPostMedia(post, token) {
  const processedPost = { ...post };

  // Handle CAROUSEL_ALBUM posts (multiple media items)
  if (post.media_type === 'CAROUSEL_ALBUM') {
    try {
      const children = await fetchChildrenMedia(post.id, token);

      // Process each child media item
      const processedChildren = await Promise.all(
        children.map(async (child) => {
          if (child.media_url) {
            const cloudinaryUrl = await uploadMediaToCloudinary(
              child.media_url,
              child.media_type,
              child.id
            );
            return {
              ...child,
              media_url: cloudinaryUrl
            };
          }
          return child;
        })
      );

      processedPost.children = processedChildren;
      // For carousel, use first child's media_url as main media_url for backward compatibility
      if (processedChildren.length > 0 && processedChildren[0].media_url) {
        processedPost.media_url = processedChildren[0].media_url;
      }
    } catch (error) {
      console.error(`Error processing CAROUSEL_ALBUM post ${post.id}:`, error.message);
    }
  }
  // Handle single IMAGE or VIDEO posts
  else if (post.media_url) {
    const cloudinaryUrl = await uploadMediaToCloudinary(
      post.media_url,
      post.media_type,
      post.id
    );
    processedPost.media_url = cloudinaryUrl;
  }

  return processedPost;
}

/**
 * Fetch Instagram posts from Graph API and proxy media through Cloudinary
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

    // Process each post to upload media to Cloudinary
    const posts = data.data || [];
    const processedPosts = await Promise.all(
      posts.map(post => processPostMedia(post, token))
    );

    // Never return Graph paging (paging.next embeds access_token).
    // Optional opaque cursor for our own pagination later (not a Graph URL).
    const afterCursor = data.paging?.cursors?.after || null;

    return {
      posts: processedPosts,
      after: afterCursor,
    };
  } catch (error) {
    // Avoid logging URLs that may contain access_token
    const message = String(error.message || error)
      .replace(/access_token=[^&\s"'\\]*/gi, 'access_token=[REDACTED]')
      .replace(/https?:\/\/graph\.facebook\.com[^\s"'\\]*/gi, '[REDACTED_GRAPH_URL]');
    console.error('Error fetching Instagram posts:', message);
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
      expires_in: data.expires_in,
      expiresAt: expiresAt,
    };
  } catch (error) {
    const message = String(error.message || error)
      .replace(/access_token=[^&\s"'\\]*/gi, 'access_token=[REDACTED]')
      .replace(/https?:\/\/graph\.facebook\.com[^\s"'\\]*/gi, '[REDACTED_GRAPH_URL]');
    console.error('❌ Failed to refresh Instagram token:', message);
    throw error;
  }
}

module.exports = {
  getInstagramToken,
  fetchInstagramPosts,
  refreshInstagramToken
};
