const OneSignal = require('onesignal-node');

// Validate OneSignal configuration
if (!process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_API_KEY) {
  console.warn('⚠️ OneSignal credentials not configured. Set ONESIGNAL_APP_ID and ONESIGNAL_REST_API_KEY in .env');
} else {
  console.log(`✅ OneSignal initialized with App ID: ${process.env.ONESIGNAL_APP_ID.substring(0, 8)}...`);
}

// Initialize OneSignal client
const client = new OneSignal.Client(
  process.env.ONESIGNAL_APP_ID, // Your OneSignal App ID
  process.env.ONESIGNAL_REST_API_KEY // Your OneSignal REST API Key
);

/**
 * Validate a OneSignal player ID by attempting to view the player
 * This helps catch invalid player IDs before trying to send notifications
 */
const validatePlayerId = async (playerId) => {
  try {
    if (!process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_API_KEY) {
      return { valid: false, reason: 'OneSignal not configured' };
    }

    // Note: OneSignal API doesn't have a direct "view player" endpoint in the node SDK
    // We'll validate by attempting to send a test notification and checking the response
    // For now, we'll just check the format
    if (!playerId || typeof playerId !== 'string' || playerId.length < 10) {
      return { valid: false, reason: 'Invalid player ID format' };
    }

    return { valid: true };
  } catch (error) {
    console.error('Error validating player ID:', error);
    return { valid: false, reason: error.message };
  }
};

/**
 * Send notification to a single user via OneSignal
 * Returns { success: boolean, invalidPlayerId: boolean, response: object }
 */
const sendOneSignalNotification = async (playerId, title, message, data = {}) => {
  try {
    const notification = {
      contents: { en: message },
      headings: { en: title },
      include_player_ids: [playerId],
      data: data,
      // iOS specific - only include if iOS is configured
      // ios_badgeType: 'Increase',
      // ios_badgeCount: 1,
      // Removed android_channel_id - OneSignal will use default channel
    };

    const response = await client.createNotification(notification);
    
    // Check for errors in response
    if (response.body && response.body.errors) {
      const errors = response.body.errors;
      
      // Check for invalid player IDs
      if (errors.invalid_player_ids && errors.invalid_player_ids.length > 0) {
        console.log(`⚠️ Invalid OneSignal player ID: ${playerId}`);
        console.log(`   This player ID may belong to a different OneSignal app.`);
        console.log(`   Current App ID: ${process.env.ONESIGNAL_APP_ID?.substring(0, 8) || 'NOT SET'}...`);
        console.log(`   Make sure the mobile app is using the same OneSignal App ID.`);
        return {
          success: false,
          invalidPlayerId: true,
          response: response
        };
      }
      
      // Log other errors
      if (Object.keys(errors).length > 0) {
        console.error('❌ OneSignal errors:', errors);
      }
    }
    
    // Check for warnings
    if (response.body && response.body.warnings) {
      response.body.warnings.forEach(warning => {
        console.log(`⚠️ OneSignal warning: ${warning}`);
      });
    }
    
    // Check if notification was actually sent (has an ID)
    if (response.body && response.body.id) {
      console.log(`✅ OneSignal notification sent successfully to player ${playerId}`);
      return {
        success: true,
        invalidPlayerId: false,
        response: response
      };
    } else {
      console.log(`⚠️ OneSignal notification may not have been sent (no ID in response)`);
      return {
        success: false,
        invalidPlayerId: false,
        response: response
      };
    }
  } catch (error) {
    console.error('❌ Error sending OneSignal notification:', error);
    throw error;
  }
};

/**
 * Send notification to multiple users
 * Returns { success: boolean, invalidPlayerIds: array, response: object }
 */
const sendOneSignalNotificationToMultiple = async (playerIds, title, message, data = {}) => {
  try {
    if (!playerIds || playerIds.length === 0) {
      console.log('No player IDs provided');
      return { success: false, invalidPlayerIds: [] };
    }

    const notification = {
      contents: { en: message },
      headings: { en: title },
      include_player_ids: playerIds,
      data: data,
      // iOS specific - only include if iOS is configured
      // ios_badgeType: 'Increase',
      // ios_badgeCount: 1,
      // Removed android_channel_id - OneSignal will use default channel
    };

    const response = await client.createNotification(notification);
    
    // Check for errors in response
    let invalidPlayerIds = [];
    if (response.body && response.body.errors) {
      const errors = response.body.errors;
      
      // Check for invalid player IDs
      if (errors.invalid_player_ids && errors.invalid_player_ids.length > 0) {
        invalidPlayerIds = errors.invalid_player_ids;
        console.log(`⚠️ Invalid OneSignal player IDs:`, invalidPlayerIds);
      }
      
      // Log other errors
      if (Object.keys(errors).length > 0) {
        console.error('❌ OneSignal errors:', errors);
      }
    }
    
    // Check for warnings
    if (response.body && response.body.warnings) {
      response.body.warnings.forEach(warning => {
        console.log(`⚠️ OneSignal warning: ${warning}`);
      });
    }
    
    // Check if notification was actually sent
    if (response.body && response.body.id) {
      console.log(`✅ OneSignal notification sent to ${playerIds.length - invalidPlayerIds.length} players`);
      return {
        success: true,
        invalidPlayerIds: invalidPlayerIds,
        response: response
      };
    } else {
      console.log(`⚠️ OneSignal notification may not have been sent (no ID in response)`);
      return {
        success: false,
        invalidPlayerIds: invalidPlayerIds,
        response: response
      };
    }
  } catch (error) {
    console.error('❌ Error sending OneSignal notification:', error);
    throw error;
  }
};

module.exports = {
  sendOneSignalNotification,
  sendOneSignalNotificationToMultiple,
  validatePlayerId,
};
