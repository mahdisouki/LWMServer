const nodemailer = require('nodemailer');
const { addStagingToSubject, addStagingBanner } = require('./emailHelpers');

const sendRetargetingEmail = async ({
    customerEmail,
    firstName,
    lastName,
    orderNumber,
    coupon20Code,
    coupon10Code,
    discount20Percentage,
    discount10Percentage,
    items,
    originalTotal,
    discountedTotal20,
    discountedTotal10,
    minFeeApplied20,
    minFeeApplied10,
    expirationHours20,
    expirationHours10,
    expiresAt20,
    expiresAt10
}) => {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD,
        },
    });

    // Format expiration dates for display
    const formatExpirationDate = (date) => {
        const d = new Date(date);
        const options = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        };
        return d.toLocaleDateString('en-GB', options);
    };

    const expirationDate20 = expiresAt20 ? formatExpirationDate(expiresAt20) : '24 hours';
    const expirationDate10 = expiresAt10 ? formatExpirationDate(expiresAt10) : '72 hours';

    // Calculate hours remaining for display
    const now = new Date();
    const expires20 = expiresAt20 ? new Date(expiresAt20) : new Date(now.getTime() + (24 * 60 * 60 * 1000));
    const expires10 = expiresAt10 ? new Date(expiresAt10) : new Date(now.getTime() + (72 * 60 * 60 * 1000));

    const hoursRemaining20 = Math.max(0, Math.floor((expires20 - now) / (1000 * 60 * 60)));
    const hoursRemaining10 = Math.max(0, Math.floor((expires10 - now) / (1000 * 60 * 60)));

    // Build items list HTML
    const itemsList = items.map(item => {
        const itemName = item.standardItemId?.itemName || item.object || 'Item';
        const position = item.Objectsposition || 'Outside';
        const quantity = item.quantity || 1;
        const price = item.price || item.standardItemId?.price || 0;
        const totalItemPrice = (price * quantity).toFixed(2);

        return `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div>
              <p style="margin: 0; font-weight: 600; color: #111827;">${itemName}</p>
              <p style="margin: 4px 0 0; font-size: 14px; color: #6b7280;">${position} • £${totalItemPrice} • Quantity: ${quantity}</p>
            </div>
          </div>
        </td>
      </tr>
    `;
    }).join('');

    const baseUrl = 'https://client.londonwastemanagement.uk/';
    const applyCodeUrl20 = `${baseUrl}/checkout?order=${orderNumber}&coupon=${coupon20Code}`;
    const applyCodeUrl10 = `${baseUrl}/checkout?order=${orderNumber}&coupon=${coupon10Code}`;

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        @media only screen and (max-width: 620px) {
          .main-table { width: 100% !important; }
          .inner { padding: 0 12px !important; }
          .coupon-container { flex-direction: column !important; }
          .discount-badge { writing-mode: horizontal-tb !important; text-orientation: mixed !important; padding: 8px 16px !important; }
        }
      </style>
    </head>
    <body style="margin:0; padding:0; font-family: Arial, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
        <tr>
          <td align="center" style="padding:24px 12px 32px;">
            <table width="600" cellpadding="0" cellspacing="0" border="0" class="main-table"
              style="border-collapse:collapse; max-width:600px; background:#ffffff; box-shadow:0 15px 38px rgba(0,0,0,0.20);">
              
              <!-- Header -->
              <tr>
                <td style="padding:0; line-height:0;">
                  <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1766528514/Group_1261156245_ngvccs.png"
                    width="600"
                    style="display:block; width:100%; height:auto; border:0; margin:0;" />
                </td>
              </tr>

              <!-- Discount Offer Section -->
              <tr>
                <td style="padding:32px 24px; background: linear-gradient(135deg, #28c152 0%, #1ea842 100%); text-align: center;">
                  <h1 style="margin: 0; font-size: 32px; font-weight: bold; color: #ffffff;">
                    Your exclusive <strong>${discount20Percentage}% discount</strong> is waiting for you
                  </h1>
                  <p style="margin: 16px 0 0; font-size: 16px; color: #ffffff; opacity: 0.95;">
                    Complete your booking in the next ${hoursRemaining20} hours and enjoy premium waste management at a better price.
                  </p>
                </td>
              </tr>

              <!-- Booking Details -->
              <tr>
                <td style="padding:24px;" class="inner">
                  <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                    <div style="background: #28c152; padding: 16px; color: #ffffff;">
                      <h2 style="margin: 0; font-size: 20px; font-weight: bold;">Your Booking Details</h2>
                    </div>
                    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                      ${itemsList}
                      <tr>
                        <td style="padding: 16px; background: #f9fafb; border-top: 2px solid #e5e7eb;">
                          <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 18px; font-weight: bold; color: #111827;">TOTAL:</span>
                            <div style="text-align: right;">
                              <span style="font-size: 16px; color: #9ca3af; text-decoration: line-through; margin-right: 8px;">£${originalTotal.toFixed(2)}</span>
                              <span style="font-size: 20px; font-weight: bold; color: #28c152;">£${discountedTotal20.toFixed(2)}</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </table>
                  </div>
                </td>
              </tr>

              <!-- Coupon Codes Section -->
              <tr>
                <td style="padding:0 24px 24px;" class="inner">
                  <!-- 20% Discount Coupon -->
                  <div style="display: flex; gap: 16px; align-items: flex-start; margin-bottom: 20px;">
                    <!-- Discount Badge -->
                    <div class="discount-badge" style="background: #28c152; color: #ffffff; padding: 16px 12px; border-radius: 8px; writing-mode: vertical-rl; text-orientation: mixed; font-weight: bold; font-size: 14px; letter-spacing: 2px;">
                      ${discount20Percentage}% DISCOUNT
                    </div>
                    
                    <!-- Coupon Card -->
                    <div style="flex: 1; background: #ffffff; border: 2px solid #28c152; border-radius: 8px; padding: 20px;">
                      <p style="margin: 0 0 8px; font-size: 14px; color: #6b7280; font-weight: 600;">${discount20Percentage}% Offered Discount</p>
                      <p style="margin: 0 0 12px; font-size: 24px; font-weight: bold; color: #111827; letter-spacing: 2px;">${coupon20Code}</p>
                      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                        <span style="font-size: 14px; color: #6b7280;">⏰ Expires: ${expirationDate20}</span>
                        <a href="${baseUrl}/countdown?coupon=${coupon20Code}&expires=${expiresAt20 ? expiresAt20.getTime() : ''}" 
                           style="font-size: 12px; color: #28c152; text-decoration: none; margin-left: 8px;">View Live Countdown →</a>
                      </div>
                      <p style="margin: 0 0 8px; font-size: 12px; color: #9ca3af;">${hoursRemaining20} hours remaining</p>
                      <p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">
                        Save £${(originalTotal - discountedTotal20).toFixed(2)} on this Order
                      </p>
                      ${minFeeApplied20 ? `<p style="margin: 0 0 16px; font-size: 12px; color: #f59e0b; font-style: italic;">
                        *Note: Minimum service fee of £45 applies. Your final total is £${discountedTotal20.toFixed(2)}.
                      </p>` : '<p style="margin: 0 0 16px;"></p>'}
                      <a href="${applyCodeUrl20}" 
                         style="display: inline-block; padding: 12px 24px; background: #28c152; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; text-align: center;">
                        Apply Code
                      </a>
                      <p style="margin: 12px 0 0; font-size: 12px; color: #9ca3af;">
                        <a href="#" style="color: #28c152; text-decoration: none;">*Terms & conditions</a>
                      </p>
                    </div>
                  </div>

                  <!-- 10% Discount Coupon -->
                  <div style="display: flex; gap: 16px; align-items: flex-start;">
                    <!-- Discount Badge -->
                    <div class="discount-badge" style="background: #28c152; color: #ffffff; padding: 16px 12px; border-radius: 8px; writing-mode: vertical-rl; text-orientation: mixed; font-weight: bold; font-size: 14px; letter-spacing: 2px;">
                      ${discount10Percentage}% DISCOUNT
                    </div>
                    
                    <!-- Coupon Card -->
                    <div style="flex: 1; background: #ffffff; border: 2px solid #28c152; border-radius: 8px; padding: 20px;">
                      <p style="margin: 0 0 8px; font-size: 14px; color: #6b7280; font-weight: 600;">${discount10Percentage}% Offered Discount</p>
                      <p style="margin: 0 0 12px; font-size: 24px; font-weight: bold; color: #111827; letter-spacing: 2px;">${coupon10Code}</p>
                      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                        <span style="font-size: 14px; color: #6b7280;">⏰ Expires: ${expirationDate10}</span>
                        <a href="${baseUrl}/countdown?coupon=${coupon10Code}&expires=${expiresAt10 ? expiresAt10.getTime() : ''}" 
                           style="font-size: 12px; color: #28c152; text-decoration: none; margin-left: 8px;">View Live Countdown →</a>
                      </div>
                      <p style="margin: 0 0 8px; font-size: 12px; color: #9ca3af;">${hoursRemaining10} hours remaining</p>
                      <p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">
                        Save £${(originalTotal - discountedTotal10).toFixed(2)} on this Order
                      </p>
                      ${minFeeApplied10 ? `<p style="margin: 0 0 16px; font-size: 12px; color: #f59e0b; font-style: italic;">
                        *Note: Minimum service fee of £45 applies. Your final total is £${discountedTotal10.toFixed(2)}.
                      </p>` : '<p style="margin: 0 0 16px;"></p>'}
                      <a href="${applyCodeUrl10}" 
                         style="display: inline-block; padding: 12px 24px; background: #28c152; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; text-align: center;">
                        Apply Code
                      </a>
                      <p style="margin: 12px 0 0; font-size: 12px; color: #9ca3af;">
                        <a href="#" style="color: #28c152; text-decoration: none;">*Terms & conditions</a>
                      </p>
                    </div>
                  </div>
                </td>
              </tr>

              <!-- Call to Action -->
              <tr>
                <td style="padding:0 24px 24px;" class="inner">
                  <div style="background: #f9fafb; border-radius: 8px; padding: 24px; text-align: center;">
                    <h3 style="margin: 0 0 12px; font-size: 20px; color: #111827;">This Offer Is Limited</h3>
                    <p style="margin: 0 0 8px; font-size: 14px; color: #6b7280;">
                      Don't miss out. If you have any questions, just reply, we're here to help.
                    </p>
                    <p style="margin: 8px 0 0; font-size: 14px; color: #28c152; font-weight: 600;">
                      Take advantage of your <strong>${discount10Percentage}% discount</strong>, you have ${hoursRemaining10} hours to use your coupon.
                    </p>
                  </div>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="padding:24px; text-align: center; background: #f9fafb; border-top: 1px solid #e5e7eb;">
                  <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1766528514/Group_1261156245_ngvccs.png" 
                       alt="London Waste Management" 
                       style="max-width: 150px; margin-bottom: 12px;" />
                  <p style="margin: 0; font-size: 14px; color: #6b7280;">Remove, Recycle & Upcycle</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

    const mailOptions = {
        from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
        to: customerEmail,
        replyTo: process.env.EMAIL_USER, // Allow replies to go to the responsible email
        subject: addStagingToSubject(`Complete Your Booking - ${discount20Percentage}% Discount Available`),
        html: addStagingBanner(html),
    };

    try {
        console.log('Sending retargeting email to customer:', customerEmail);
        console.log('Email configuration:', {
            from: mailOptions.from,
            to: mailOptions.to,
            subject: mailOptions.subject
        });
        const result = await transporter.sendMail(mailOptions);
        console.log('Retargeting email sent successfully!', {
            to: customerEmail,
            messageId: result.messageId,
            accepted: result.accepted,
            rejected: result.rejected,
            response: result.response
        });

        // Check if email was rejected
        if (result.rejected && result.rejected.length > 0) {
            console.error('Email was rejected:', result.rejected);
        }

        return result;
    } catch (error) {
        console.error('Error sending retargeting email:', error);
        throw error;
    }
};

module.exports = { sendRetargetingEmail };

