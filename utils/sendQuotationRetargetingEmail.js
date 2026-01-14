const nodemailer = require('nodemailer');
const { addStagingToSubject, addStagingBanner } = require('./emailHelpers');

const sendQuotationRetargetingEmail = async ({
    customerEmail,
    customerName,
    coupon20Code,
    coupon10Code,
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

    // Calculate time remaining for countdown display
    const now = new Date();
    const expires20 = expiresAt20 ? new Date(expiresAt20) : new Date(now.getTime() + (24 * 60 * 60 * 1000));
    const expires10 = expiresAt10 ? new Date(expiresAt10) : new Date(now.getTime() + (72 * 60 * 60 * 1000));

    // Calculate hours, minutes, seconds remaining for 20% coupon (static display)
    const timeRemaining20 = Math.max(0, expires20 - now);
    const hours20 = Math.floor(timeRemaining20 / (1000 * 60 * 60));
    const minutes20 = Math.floor((timeRemaining20 % (1000 * 60 * 60)) / (1000 * 60));
    const seconds20 = Math.floor((timeRemaining20 % (1000 * 60)) / 1000);
    const countdown20 = `${String(hours20).padStart(2, '0')}:${String(minutes20).padStart(2, '0')}:${String(seconds20).padStart(2, '0')}`;

    // Base URL for any links
    const baseUrl = process.env.CLIENT_URL || 'https://client.londonwastemanagement.uk';

    // Format customer name
    const displayName = customerName || 'Customer';

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
          .coupon-box { flex-direction: column !important; }
        }
      </style>
    </head>
    <body style="margin:0; padding:0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; background-color: #f5f5f5;">
        <tr>
          <td align="center" style="padding:24px 12px 32px;">
            <table width="600" cellpadding="0" cellspacing="0" border="0" class="main-table"
              style="border-collapse:collapse; max-width:600px; background:#ffffff; border-radius: 8px; overflow: hidden;">
              
              <!-- Header with Logo -->
              <tr>
                <td style="padding:32px 24px; text-align: center; background: #ffffff;">
                  <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1766528514/Group_1261156245_ngvccs.png" 
                       alt="London Waste Management" 
                       style="max-width: 200px; height: auto; margin-bottom: 16px;" />
                  <h1 style="margin: 0; font-size: 28px; font-weight: bold; color: #111827; line-height: 1.3;">
                    SAVE UP TO <strong style="color: #28c152;">20%</strong> ON YOUR WASTE REMOVAL QUOTE
                  </h1>
                  <p style="margin: 16px 0 0; font-size: 14px; color: #6b7280; line-height: 1.6;">
                    We recently sent you a quote for your waste removal request and noticed you haven't moved forward yet.
                  </p>
                  <p style="margin: 12px 0 0; font-size: 14px; color: #374151; line-height: 1.6;">
                    We understand that price matters, so to help you decide, we've added two limited time discount options you can choose from:
                  </p>
                </td>
              </tr>

              <!-- Main Offer Section with Gradient Background -->
              <tr>
                <td style="padding:0; background: linear-gradient(135deg, #e8f5e9 0%, #ffffff 100%); position: relative;">
                  <!-- Subtle grid pattern overlay -->
                  <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-image: repeating-linear-gradient(0deg, transparent, transparent 20px, rgba(40, 193, 82, 0.03) 20px, rgba(40, 193, 82, 0.03) 21px); pointer-events: none;"></div>
                  
                  <!-- Discount Offers -->
                  <div style="position: relative; padding: 32px 24px;">
                    
                    <!-- 20% OFF Discount Box -->
                    <div style="background: #ffffff; border-radius: 12px; border-left: 4px solid #28c152; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                      <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
                        <div style="width: 60px; height: 60px; background: #28c152; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                          <span style="color: #ffffff; font-size: 20px; font-weight: bold;">20%</span>
                        </div>
                        <div style="flex: 1;">
                          <p style="margin: 0; font-size: 18px; font-weight: bold; color: #111827;">
                            <strong>20% OFF</strong> – use code
                          </p>
                          <p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">
                            Ends in ⏳ ${countdown20}
                          </p>
                        </div>
                      </div>
                      <div style="text-align: center;">
                        <p style="margin: 0 0 12px; font-size: 20px; font-weight: bold; color: #111827; letter-spacing: 3px; font-family: monospace;">
                          ${coupon20Code}
                        </p>
                        <a href="mailto:?subject=Coupon Code ${coupon20Code}&body=Coupon Code: ${coupon20Code}%0A%0AUse this code to get 20% off your waste removal quote!" 
                           style="display: inline-block; background: #28c152; color: #ffffff; border: none; border-radius: 8px; padding: 12px 32px; font-size: 16px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 8px;">
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M13.3333 6H7.33333C6.59695 6 6 6.59695 6 7.33333V13.3333C6 14.0697 6.59695 14.6667 7.33333 14.6667H13.3333C14.0697 14.6667 14.6667 14.0697 14.6667 13.3333V7.33333C14.6667 6.59695 14.0697 6 13.3333 6Z" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            <path d="M3.33333 10H2.66667C2.31305 10 2 9.68695 2 9.33333V3.33333C2 2.97971 2.31305 2.66667 2.66667 2.66667H8.66667C9.02029 2.66667 9.33333 2.97971 9.33333 3.33333V4" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                          </svg>
                          Copy Coupon
                        </a>
                      </div>
                    </div>

                    <!-- 10% OFF Discount Box -->
                    <div style="background: #ffffff; border-radius: 12px; border-left: 4px solid #3b82f6; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                      <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
                        <div style="width: 60px; height: 60px; background: #3b82f6; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                          <span style="color: #ffffff; font-size: 20px; font-weight: bold;">10%</span>
                        </div>
                        <div style="flex: 1;">
                          <p style="margin: 0; font-size: 18px; font-weight: bold; color: #111827;">
                            <strong>10% OFF</strong> – use code
                          </p>
                          <p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">
                            Valid for 72 hours
                          </p>
                        </div>
                      </div>
                      <div style="text-align: center;">
                        <p style="margin: 0 0 12px; font-size: 20px; font-weight: bold; color: #111827; letter-spacing: 3px; font-family: monospace;">
                          ${coupon10Code}
                        </p>
                        <a href="mailto:?subject=Coupon Code ${coupon10Code}&body=Coupon Code: ${coupon10Code}%0A%0AUse this code to get 10% off your waste removal quote!" 
                           style="display: inline-block; background: #3b82f6; color: #ffffff; border: none; border-radius: 8px; padding: 12px 32px; font-size: 16px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 8px;">
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M13.3333 6H7.33333C6.59695 6 6 6.59695 6 7.33333V13.3333C6 14.0697 6.59695 14.6667 7.33333 14.6667H13.3333C14.0697 14.6667 14.6667 14.0697 14.6667 13.3333V7.33333C14.6667 6.59695 14.0697 6 13.3333 6Z" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                            <path d="M3.33333 10H2.66667C2.31305 10 2 9.68695 2 9.33333V3.33333C2 2.97971 2.31305 2.66667 2.66667 2.66667H8.66667C9.02029 2.66667 9.33333 2.97971 9.33333 3.33333V4" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                          </svg>
                          Copy Coupon
                        </a>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>

              <!-- Call to Action Section -->
              <tr>
                <td style="padding:32px 24px; text-align: center; background: #ffffff;">
                  <h2 style="margin: 0 0 16px; font-size: 24px; font-weight: bold; color: #111827;">
                    <strong>This Offer Is Limited</strong>
                  </h2>
                  <p style="margin: 0; font-size: 16px; color: #374151; line-height: 1.6;">
                    Don't miss out, <a href="mailto:${process.env.EMAIL_USER || 'hello@londonwastemanagement.com'}" style="color: #28c152; text-decoration: none; font-weight: 600;">reply to this email</a> to confirm the quotation and let our team create your order!
                  </p>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="padding:24px; background: #ffffff; border-top: 1px solid #e5e7eb;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="vertical-align: middle;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                          <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1766528514/Group_1261156245_ngvccs.png" 
                               alt="London Waste Management" 
                               style="max-width: 120px; height: auto;" />
                          <span style="font-size: 14px; color: #374151; font-weight: 600;">London Waste Management</span>
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8 0L9.79772 5.52786L15.6085 5.52786L10.9054 8.94427L12.7031 14.4721L8 11.0557L3.29686 14.4721L5.09458 8.94427L0.391441 5.52786L6.20228 5.52786L8 0Z" fill="#28c152"/>
                          </svg>
                        </div>
                        <p style="margin: 8px 0 0; font-size: 12px; color: #6b7280;">
                          Remove, Recycle & Upcycle
                        </p>
                      </td>
                      <td align="right" style="vertical-align: middle;">
                        <div style="display: flex; gap: 12px; justify-content: flex-end;">
                          <a href="https://www.facebook.com" style="display: inline-block; width: 32px; height: 32px; background: #1877f2; border-radius: 50%; display: flex; align-items: center; justify-content: center; text-decoration: none;">
                            <span style="color: #ffffff; font-weight: bold; font-size: 14px;">f</span>
                          </a>
                          <a href="https://www.instagram.com" style="display: inline-block; width: 32px; height: 32px; background: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; text-decoration: none;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                            </svg>
                          </a>
                          <a href="https://www.linkedin.com" style="display: inline-block; width: 32px; height: 32px; background: #0077b5; border-radius: 50%; display: flex; align-items: center; justify-content: center; text-decoration: none;">
                            <span style="color: #ffffff; font-weight: bold; font-size: 12px;">in</span>
                          </a>
                          <a href="https://www.twitter.com" style="display: inline-block; width: 32px; height: 32px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 50%; display: flex; align-items: center; justify-content: center; text-decoration: none;">
                            <span style="color: #000000; font-weight: bold; font-size: 14px;">X</span>
                          </a>
                        </div>
                      </td>
                    </tr>
                  </table>
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
        replyTo: process.env.EMAIL_USER,
        subject: addStagingToSubject('Save Up To 20% On Your Waste Removal Quote'),
        html: addStagingBanner(html),
    };

    try {
        console.log('Sending quotation retargeting email to customer:', customerEmail);
        const result = await transporter.sendMail(mailOptions);
        console.log('Quotation retargeting email sent successfully!', {
            to: customerEmail,
            messageId: result.messageId,
        });
        return result;
    } catch (error) {
        console.error('Error sending quotation retargeting email:', error);
        throw error;
    }
};

module.exports = { sendQuotationRetargetingEmail };

