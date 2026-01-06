const axios = require('axios');
const { getAccessToken } = require('./calendarAuthHelper');
const StandardItem = require('../models/StandardItem');

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

/**
 * Create a calendar event for an order/task
 * @param {String} adminId - Admin ID who owns the calendar
 * @param {Object} task - Task/Order object
 * @returns {Promise<Object>} Created calendar event
 */
async function createCalendarEvent(adminId, task) {
  try {
    const accessToken = await getAccessToken(adminId);
    
    // Parse the date and time window
    const eventDate = new Date(task.date);
    const { startDateTime, endDateTime } = parseTimeWindow(eventDate, task.available);
    
    // Build event description (now async to populate standard items)
    const description = await buildEventDescription(task);
    
    // Build event location
    const location = task.location?.address || 
                     (task.collectionAddress || task.billingAddress) || 
                     `${task.postcode || ''}`;
    
    // Customer name
    const customerName = task.firstName && task.lastName
      ? `${task.firstName} ${task.lastName}`
      : task.bussinessName || 'Customer';
    
    // Event title
    const eventTitle = `Order #${task.orderNumber || task._id} - ${customerName}`;
    
    // Create calendar event
    const event = {
      summary: eventTitle,
      description: description,
      location: location,
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'Europe/London', // Adjust to your timezone
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'Europe/London',
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 }, // 1 day before
          { method: 'popup', minutes: 60 }, // 1 hour before
        ],
      },
      colorId: getColorIdForStatus(task.taskStatus),
    };
    
    // Make direct HTTP request to Google Calendar API
    const response = await axios.post(
      `${CALENDAR_API_BASE}/calendars/primary/events`,
      event,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    console.log('Calendar event created:', response.data.htmlLink);
    return response.data;
  } catch (error) {
    // Handle specific OAuth errors
    if (error.message && error.message.includes('CALENDAR_SCOPE_MISSING')) {
      console.error('⚠️ Calendar scope missing. Admin needs to re-authenticate:', error.message);
      throw new Error('CALENDAR_SCOPE_MISSING: Please re-authenticate your Google account to grant Calendar permissions.');
    }
    
    if (error.response?.status === 401 || error.message?.includes('invalid_grant') || error.message?.includes('INVALID_GRANT')) {
      console.error('⚠️ Invalid grant error - tokens may be expired or missing Calendar scope.');
      console.error('💡 Solution: Admin needs to re-authenticate at /api/gmail/auth/google?adminId=' + adminId);
      throw new Error('INVALID_GRANT: Google tokens are invalid or missing Calendar scope. Please re-authenticate.');
    }
    
    console.error('Error creating calendar event:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Parse time window and return start/end datetime
 */
function parseTimeWindow(date, available) {
  const startDate = new Date(date);
  const endDate = new Date(date);
  
  // Set time based on available window
  switch (available) {
    case '7am-12pm':
      startDate.setHours(7, 0, 0, 0);
      endDate.setHours(12, 0, 0, 0);
      break;
    case '12pm-5pm':
      startDate.setHours(12, 0, 0, 0);
      endDate.setHours(17, 0, 0, 0);
      break;
    case 'AnyTime':
    default:
      // Default to 9 AM - 5 PM for all-day orders
      startDate.setHours(9, 0, 0, 0);
      endDate.setHours(17, 0, 0, 0);
      break;
  }
  
  return { startDateTime: startDate, endDateTime: endDate };
}

/**
 * Build event description from task details
 * Now async to populate standardItemId
 */
async function buildEventDescription(task) {
  const lines = [];
  
  // Customer info
  if (task.firstName || task.lastName) {
    lines.push(`Customer: ${task.firstName || ''} ${task.lastName || ''}`.trim());
  }
  if (task.bussinessName) {
    lines.push(`Business: ${task.bussinessName}`);
  }
  lines.push(`Phone: ${task.phoneNumber}`);
  if (task.phoneNumber2) {
    lines.push(`Phone 2: ${task.phoneNumber2}`);
  }
  if (task.email) {
    lines.push(`Email: ${task.email}`);
  }
  
  lines.push(''); // Empty line
  
  // Order details
  lines.push(`Order Number: #${task.orderNumber || task._id}`);
  lines.push(`Status: ${task.taskStatus}`);
  lines.push(`Payment Status: ${task.paymentStatus}`);
  if (task.paymentMethod) {
    lines.push(`Payment Method: ${task.paymentMethod}`);
  }
  lines.push(`Total Price: £${task.totalPrice?.toFixed(2) || '0.00'}`);
  
  lines.push(''); // Empty line
  
  // Items - populate standardItemId if needed
  if (task.items && task.items.length > 0) {
    lines.push('Items:');
    
    // Process items and populate standardItemId if it's not already populated
    for (let index = 0; index < task.items.length; index++) {
      const item = task.items[index];
      let itemName = item.object;
      
      // If no object name but has standardItemId, populate it
      if (!itemName && item.standardItemId) {
        try {
          // Check if standardItemId is already populated (has itemName property)
          if (item.standardItemId && typeof item.standardItemId === 'object' && item.standardItemId.itemName) {
            itemName = item.standardItemId.itemName;
          } else if (item.standardItemId && typeof item.standardItemId === 'string') {
            // It's an ObjectId string, need to fetch the StandardItem
            const standardItem = await StandardItem.findById(item.standardItemId);
            itemName = standardItem ? standardItem.itemName : 'Standard Item';
          } else if (item.standardItemId && item.standardItemId._id) {
            // It's an ObjectId object, need to fetch the StandardItem
            const standardItem = await StandardItem.findById(item.standardItemId._id || item.standardItemId);
            itemName = standardItem ? standardItem.itemName : 'Standard Item';
          } else {
            itemName = 'Standard Item';
          }
        } catch (error) {
          console.error('Error fetching standard item:', error);
          itemName = 'Standard Item';
        }
      }
      
      // Fallback if still no name
      if (!itemName) {
        itemName = 'Item';
      }
      
      const price = item.standardItemId?.price || item.customPrice || 0;
      lines.push(`  ${index + 1}. ${itemName} x${item.quantity || 1} - £${price.toFixed(2)}`);
    }
  }
  
  lines.push(''); // Empty line
  
  // Notes
  if (task.additionalNotes) {
    lines.push(`Notes: ${task.additionalNotes}`);
  }
  if (task.privateNotes) {
    lines.push(`Private Notes: ${task.privateNotes}`);
  }
  
  return lines.join('\n');
}

/**
 * Get color ID based on task status
 */
function getColorIdForStatus(status) {
  const colorMap = {
    'New': '9', // Blue
    'Processing': '5', // Yellow
    'Completed': '10', // Green
    'Cancelled': '8', // Red
    'Failed': '11', // Red
  };
  return colorMap[status] || '1'; // Default to Lavender
}

/**
 * Update calendar event when task is updated
 */
async function updateCalendarEvent(adminId, task, eventId) {
  try {
    const accessToken = await getAccessToken(adminId);
    
    const { startDateTime, endDateTime } = parseTimeWindow(new Date(task.date), task.available);
    const description = await buildEventDescription(task);
    const location = task.location?.address || task.collectionAddress || task.billingAddress || '';
    const customerName = task.firstName && task.lastName
      ? `${task.firstName} ${task.lastName}`
      : task.bussinessName || 'Customer';
    const eventTitle = `Order #${task.orderNumber || task._id} - ${customerName}`;
    
    const event = {
      summary: eventTitle,
      description: description,
      location: location,
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'Europe/London',
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'Europe/London',
      },
      colorId: getColorIdForStatus(task.taskStatus),
    };
    
    const response = await axios.put(
      `${CALENDAR_API_BASE}/calendars/primary/events/${eventId}`,
      event,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    console.log('Calendar event updated:', response.data.htmlLink);
    return response.data;
  } catch (error) {
    if (error.message && error.message.includes('CALENDAR_SCOPE_MISSING')) {
      console.error('⚠️ Calendar scope missing:', error.message);
      throw new Error('CALENDAR_SCOPE_MISSING');
    }
    
    if (error.response?.status === 401 || error.message?.includes('invalid_grant') || error.message?.includes('INVALID_GRANT')) {
      console.error('⚠️ Invalid grant error during calendar update');
      throw new Error('INVALID_GRANT');
    }
    
    console.error('Error updating calendar event:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Delete calendar event
 */
async function deleteCalendarEvent(adminId, eventId) {
  try {
    const accessToken = await getAccessToken(adminId);
    
    await axios.delete(
      `${CALENDAR_API_BASE}/calendars/primary/events/${eventId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );
    
    console.log('Calendar event deleted:', eventId);
    return true;
  } catch (error) {
    if (error.message && error.message.includes('CALENDAR_SCOPE_MISSING')) {
      console.error('⚠️ Calendar scope missing:', error.message);
      throw new Error('CALENDAR_SCOPE_MISSING');
    }
    
    if (error.response?.status === 401 || error.message?.includes('invalid_grant') || error.message?.includes('INVALID_GRANT')) {
      console.error('⚠️ Invalid grant error during calendar deletion');
      throw new Error('INVALID_GRANT');
    }
    
    console.error('Error deleting calendar event:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
};

