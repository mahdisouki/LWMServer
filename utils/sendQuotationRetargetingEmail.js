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

  // Generate dynamic countdown timer URL using countdownmail.com (free email countdown timer service)
  // This creates an animated GIF that counts down in real-time
  const countdownTimerUrl = `https://i.countdownmail.com/2/hashCode.gif?${expires20.toISOString()}&timezone=Europe%2FLondon&font=cursive&width=200&height=50&fntclr=28c152&kn498g98=60`;

  // Fallback static countdown for email clients that don't support external images
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
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!--[if gte mso 9]>
  <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG/>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
  </xml>
  <![endif]-->
  <style>
    @media only screen and (max-width: 620px) {
      .main-table { width: 100% !important; }
      .inner { padding: 0 12px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; font-family: Arial, sans-serif; background-color: #ffffff;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; background-color: #ffffff;">
    <tr>
      <td align="center" style="padding:0;">

        <!--[if gte mso 9]>
        <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;">
          <v:fill type="frame" src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1768470220/samples/Ignored_Quote_Email_3_yphlbs.png" />
          <v:textbox style="mso-fit-shape-to-text:true" inset="0,0,0,0">
        <![endif]-->

        <table width="600" cellpadding="0" cellspacing="0" border="0" class="main-table"
          style="border-collapse:collapse; max-width:600px; background-image: url('https://res.cloudinary.com/dehzhd6xs/image/upload/v1768470220/samples/Ignored_Quote_Email_3_yphlbs.png'); background-size: 100% auto; background-repeat: no-repeat; background-position: top center;">

          <!-- Header Content (on top of background) -->
          <tr>
            <td style="padding: 20px 50px 10px; text-align: center;">
              <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1768384829/uploads/LondonWasteManagementLogo-Landscape-White_1_icxlkf.png"
                   alt="London Waste Management"
                   style="width: 100%; max-width: 130px; height: auto;" />
            </td>
          </tr>

          <!-- Main Headline -->
          <tr>
            <td style="padding: 8px 50px 12px; text-align: center;">
              <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: #ffffff; line-height: 1.1; text-transform: uppercase;">
                SAVE UP TO
              </h1>
              <h1 style="margin: 2px 0 8px; font-size: 48px; font-weight: 900; color: #ffffff; line-height: 1; text-transform: uppercase;">
                20%
              </h1>
              <h2 style="margin: 0; font-size: 14px; font-weight: 600; color: #ffffff; line-height: 1.4; text-transform: uppercase; letter-spacing: 0.5px;">
                ON YOUR WASTE<br/>REMOVAL QUOTE
              </h2>
            </td>
          </tr>

          <!-- Intro Text -->
          <tr>
            <td style="padding: 14px 70px 10px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #ffffff; line-height: 1.5; font-style: italic;">
                We recently sent you a quote for your waste removal request and noticed you haven't moved forward yet.
              </p>
            </td>
          </tr>

          <!-- Second Intro Text -->
          <tr>
            <td style="padding: 16px 50px 16px; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #374151; line-height: 1.5;">
                We understand that price matters, so to help you decide, we've added two limited time discount options you can choose from:
              </p>
            </td>
          </tr>

          <!-- 20% OFF Coupon Box -->
          <tr>
            <td style="padding: 0 100px 8px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border-radius: 16px; border: 1px solid #e5e7eb; overflow: hidden;">
                <tr>
                  <td style="padding: 16px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="50" style="vertical-align: middle;">
                          <!-- Green Circle Badge -->
                          <table cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td style="width: 46px; height: 46px; background: #28c152; border-radius: 50%; text-align: center; vertical-align: middle;">
                                <span style="color: #ffffff; font-size: 12px; font-weight: 700;">20%</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td style="padding-left: 14px; vertical-align: middle;">
                          <p style="margin: 0; font-size: 15px; font-weight: 700; color: #111827;">
                            20% OFF – use code
                          </p>
                          <p style="margin: 3px 0 0; font-size: 12px; color: #6b7280;">
                            Ends in ⏳ ${countdown20}
                          </p>
                        </td>
                      </tr>
                    </table>
                    <!-- Copy Coupon Button -->
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 14px;">
                      <tr>
                        <td align="center">
                          <a href="mailto:${process.env.EMAIL_USER || 'hello@londonwastemanagement.com'}?subject=I want to use my 20%25 discount code: ${coupon20Code}&body=Hi,%0A%0AI would like to use my 20%25 discount coupon code: ${coupon20Code}%0A%0APlease help me proceed with my waste removal quote.%0A%0AThank you!" 
                             style="display: inline-block; background: #28c152; color: #ffffff; border-radius: 20px; padding: 10px 24px; font-size: 13px; font-weight: 600; text-decoration: none;">
                            Copy Coupon 📋
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- 10% OFF Coupon Box (Smaller/More Compact) -->
          <tr>
            <td style="padding: 0 120px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f8f9fa; border-radius: 14px; border: 1px solid #e5e7eb; overflow: hidden;">
                <tr>
                  <td style="padding: 12px 16px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="40" style="vertical-align: middle;">
                          <!-- Teal Circle Badge (Smaller) -->
                          <table cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td style="width: 36px; height: 36px; background: #4EB5C0; border-radius: 50%; text-align: center; vertical-align: middle;">
                                <span style="color: #ffffff; font-size: 10px; font-weight: 700;">10%</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td style="padding-left: 10px; vertical-align: middle;">
                          <p style="margin: 0; font-size: 13px; font-weight: 700; color: #111827;">
                            10% OFF – use code
                          </p>
                          <p style="margin: 2px 0 0; font-size: 11px; color: #6b7280;">
                            Valid for 72 hours
                          </p>
                        </td>
                      </tr>
                    </table>
                    <!-- Copy Coupon Button (Smaller) -->
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 10px;">
                      <tr>
                        <td align="center">
                          <a href="mailto:${process.env.EMAIL_USER || 'hello@londonwastemanagement.com'}?subject=I want to use my 10%25 discount code: ${coupon10Code}&body=Hi,%0A%0AI would like to use my 10%25 discount coupon code: ${coupon10Code}%0A%0APlease help me proceed with my waste removal quote.%0A%0AThank you!" 
                             style="display: inline-block; background: #4EB5C0; color: #ffffff; border-radius: 16px; padding: 8px 20px; font-size: 12px; font-weight: 600; text-decoration: none;">
                            Copy Coupon 📋
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- This Offer Is Limited Section -->
          <tr>
            <td style="padding: 20px 50px 24px; text-align: center;">
              <h2 style="margin: 0 0 10px; font-size: 20px; font-weight: 700; color: #111827;">
                This Offer Is Limited
              </h2>
              <p style="margin: 0; font-size: 13px; color: #374151; line-height: 1.6;">
                Don't miss out, <strong>reply to this email</strong> to confirm the quotation and let our team create your order!
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 50px 70px 24px; border-top: 1px solid #e5e7eb;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <!-- Left: Logo + Company Info -->
                  <td style="vertical-align: middle;" align="left">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="vertical-align: middle; padding-right: 8px;">
                          <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1768385074/Profile_Picture_3_rjvnzp.png" 
                               alt="LWM" 
                               style="width: 26px; height: 26px; border-radius: 50%;" />
                        </td>
                        <td style="vertical-align: middle;">
                          <p style="margin: 0; font-size: 11px; color: #111827; font-weight: 700; line-height: 1.3;">
                            London Waste Management <span style="color: #28c152;">✓</span>
                          </p>
                          <p style="margin: 1px 0 0 0; font-size: 8px; color: #28c152; line-height: 1;">
                            Remove, Recycle & Upcycle
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <!-- Right: Social Icons -->
                  <td style="vertical-align: middle;" align="right">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding-left: 6px;">
                          <a href="https://www.facebook.com/rubbishlovers" style="text-decoration: none;">
                            <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1768468200/samples/Group_5_r8avxw.png" 
                                 alt="Facebook" 
                                 style="width: 24px; height: 24px;" />
                          </a>
                        </td>
                        <td style="padding-left: 6px;">
                          <a href="https://www.instagram.com/londonwastemanagementuk/" style="text-decoration: none;">
                            <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1768468200/samples/Group_6_zilxrc.png" 
                                 alt="Instagram" 
                                 style="width: 24px; height: 24px;" />
                          </a>
                        </td>
                        <td style="padding-left: 6px;">
                          <a href="https://www.linkedin.com/company/londonwastemanagement" style="text-decoration: none;">
                            <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1768468200/samples/Group_7_ksbcqr.png" 
                                 alt="LinkedIn" 
                                 style="width: 24px; height: 24px;" />
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        
        <!--[if gte mso 9]>
          </v:textbox>
        </v:rect>
        <![endif]-->
        
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

