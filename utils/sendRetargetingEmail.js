const nodemailer = require('nodemailer');
const { addStagingToSubject, addStagingBanner } = require('./emailHelpers');
const { createCountdownTimer } = require('./countdownMail');

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

    // Generate countdown timer for 20% coupon
    const timeRemaining20 = Math.max(0, expires20 - now);
    const hours20 = Math.floor(timeRemaining20 / (1000 * 60 * 60));
    const minutes20 = Math.floor((timeRemaining20 % (1000 * 60 * 60)) / (1000 * 60));
    const seconds20 = Math.floor((timeRemaining20 % (1000 * 60)) / 1000);
    const countdown20 = `${String(hours20).padStart(2, '0')}:${String(minutes20).padStart(2, '0')}:${String(seconds20).padStart(2, '0')}`;

    // Create real CountdownMail timer via API
    let countdownTimerUrl = null;
    try {
        const countdownTimer = await createCountdownTimer({
            name: `20% Discount - ${customerEmail}`,
            expiresAt: expires20.toISOString().replace("T", " ").slice(0, 19),
            timezone: "Europe/London"
        });
        countdownTimerUrl = countdownTimer.src;
        console.log(`✅ CountdownMail timer created for retargeting: ${countdownTimer.code}`);
    } catch (error) {
        console.error('⚠️ Failed to create CountdownMail timer, using fallback:', error.message);
    }

    // Build items list HTML with new design
    const itemsList = items.map(item => {
        const itemName = item.standardItemId?.itemName || item.object || 'Item';
        const position = item.Objectsposition || 'Outside the property';
        const quantity = item.quantity || 1;
        const price = item.price || item.standardItemId?.price || 0;
        const totalItemPrice = (price * quantity).toFixed(2);
        const itemImage = item.standardItemId?.image || 'https://placehold.co/40x40/f5f5f5/333?text=' + encodeURIComponent(itemName.charAt(0));

        return `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 15px;">
        <tr>
          <td width="60" valign="top">
            <div style="background: #f5f5f5; border-radius: 8px; padding: 10px; width: 40px; height: 40px; text-align: center;">
              <img src="${itemImage}" width="40" style="display:block; border-radius: 4px; max-height: 40px; object-fit: contain;">
            </div>
          </td>
          <td valign="top" style="padding-left: 10px;">
            <p style="margin: 0 0 4px 0; font-weight: bold; color: #333; font-size: 14px;">${itemName}</p>
            <p style="margin: 0; font-size: 12px; color: #888;">${position}</p>
            <p style="margin: 5px 0 0 0; font-size: 13px; color: #4CAF50; font-weight: bold;">
              £${price.toFixed(2)} <span style="font-size: 11px; color:#999; font-weight: normal; margin-left: 5px;">Quantity: ${quantity}</span>
            </p>
          </td>
        </tr>
      </table>
    `;
    }).join('');

    const baseUrl = 'https://client.londonwastemanagement.uk/';
    const applyCodeUrl20 = `${baseUrl}`
    const applyCodeUrl10 = `${baseUrl}`;

    const html = `
    <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
    <html xmlns="http://www.w3.org/1999/xhtml">
    <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Exclusive Discount</title>
        <style type="text/css">
            body {
                margin: 0;
                padding: 0;
                min-width: 100%;
                font-family: 'Helvetica', 'Arial', sans-serif;
            }
            table {
                border-spacing: 0;
                border-collapse: collapse;
            }
            td {
                padding: 0;
            }
            img {
                border: 0;
                display: block;
            }
            .content-padding {
                padding-left: 20px;
                padding-right: 20px;
            }
            .gradient-bg {
                background: linear-gradient(180deg, #2fb344 0%, #7fcf8a 45%, #c8edd0 75%, #e4fce4 100%);
            }
            .booking-card {
                box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
                border-radius: 16px;
                overflow: hidden;
            }
            @media screen and (max-width: 600px) {
                .container {
                    width: 100% !important;
                }
                .booking-card {
                    width: 100% !important;
                    max-width: 100% !important;
                }
                .small-coupon {
                    width: 90% !important;
                    max-width: 220px !important;
                }
                .h1-mobile {
                    font-size: 28px !important;
                }
                .content-cell {
                    padding-left: 20px !important;
                    padding-right: 20px !important;
                }
            }
        </style>
    </head>
    <body style="margin: 0; padding: 0;">
        <!-- Outer Wrapper -->
        <table border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
                <td align="center">
                    <!-- Main Container (Max 600px) with full gradient background -->
                    <table border="0" cellpadding="0" cellspacing="0" width="600" class="container" style="width: 600px; max-width: 600px; background-image: url('https://res.cloudinary.com/dehzhd6xs/image/upload/v1768503276/samples/Group_1000008589_1_ryjrnz.png'); background-size: 100% auto; background-position: top center; background-repeat: no-repeat;">
                        <!-- 1. HEADER SECTION -->
                        <tr>
                            <td align="center" style="height: 350px;">
                                <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                    <!-- Logo -->
                                    <tr>
                                        <td align="center" style="padding-top: 10px; padding-bottom: 10px;">
                                            <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1768384829/uploads/LondonWasteManagementLogo-Landscape-White_1_icxlkf.png" alt="Logo" width="180" style="color: #fff; font-size:12px; opacity: 0.9;" />
                                        </td>
                                    </tr>
                                    <!-- Main Title -->
                                    <tr>
                                        <td align="center" style="padding: 0 40px 20px 40px;">
                                            <h1 class="h1-mobile" style="color: #ffffff; font-size: 38px; font-weight: 800; margin: 0; line-height: 1.1; letter-spacing: -0.5px; text-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                                                Your exclusive<br />
                                                ${discount20Percentage}% discount<br />
                                                is waiting for you
                                            </h1>
                                        </td>
                                    </tr>
                                    <!-- Subtitle -->
                                    <tr>
                                        <td align="center" style="padding: 0 50px;">
                                            <p style="color: #030202; font-size: 14px; margin: 0; line-height: 1.5; font-weight: 500; opacity: 0.9;">
                                                Complete your booking in the next 24 hours and enjoy premium<br />
                                                waste management at a better price
                                            </p>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>

                        <!-- SPACER to push booking card down -->
                        <tr>
                            <td style="height: 160px;"></td>
                        </tr>

                        <!-- 2. CONTENT SECTION -->
                        <tr>
                            <td align="center" valign="top">
                                    <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                        <tr>
                                            <td align="center" class="content-cell" style="padding: 0 50px;">
                                                <!-- BOOKING CARD -->
                                                <table border="0" cellpadding="0" cellspacing="0" width="380" class="booking-card" style="width: 380px; max-width: 380px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.15); background-color: #ffffff; margin-bottom: -100px; position: relative; z-index: 10;">
                                                    <!-- Card Header -->
                                                    <tr>
                                                        <td style="background-color: #5bb35f; padding: 12px 20px;">
                                                            <p style="color: #ffffff; font-size: 14px; font-weight: bold; margin: 0; text-shadow: 0 1px 2px rgba(0,0,0,0.1);">
                                                                Your Booking Details</p>
                                                        </td>
                                                    </tr>

                                                    <!-- Card Content -->
                                                    <tr style="z-index: 999 !important;">
                                                        <td style="padding: 25px;">
                                                            <p style="color: #222; font-weight: bold; font-size: 15px; margin: 0 0 20px 0;">
                                                                Items list</p>
                                                            ${itemsList}
                                                            <div style="height: 1px; background-color: #eee; width: 100%; margin: 15px 0;"></div>
                                                            <!-- Total -->
                                                            <table width="100%">
                                                                <tr>
                                                                    <td align="left">
                                                                        <p style="margin:0; font-weight:bold; color:#333; font-size: 13px;">
                                                                            TOTAL :</p>
                                                                    </td>
                                                                    <td align="right">
                                                                        <p style="margin:0; font-weight:bold; color:#2E7D32; font-size: 15px;">
                                                                            £${discountedTotal20.toFixed(2)} <span style="text-decoration: line-through; color: #aaa; font-size: 12px; margin-left: 5px;">£${originalTotal.toFixed(2)}</span>
                                                                        </p>
                                                                    </td>
                                                                </tr>
                                                            </table>
                                                        </td>
                                                    </tr>

                                                    <!-- Green Coupon Section -->
                                                    <tr>
                                                        <td style="padding: 0 15px 15px 15px;">
                                                            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f8e9; border: 1px dashed #66BB6A; border-radius: 8px; overflow: hidden;">
                                                                <tr>
                                                                    <td width="35" valign="middle" align="center" style="background-color: #4CAF50;">
                                                                        <p style="font-size: 10px; font-weight: bold; color: #fff; margin:0; line-height: 12px; padding: 10px 5px; text-align: center; writing-mode: vertical-rl;transform: rotate(180deg);">
                                                                            ${discount20Percentage}% Discount
                                                                        </p>
                                                                    </td>
                                                                    <td style="padding: 15px;">
                                                                        <p style="font-size: 13px; font-weight: bold; color: #333; margin: 0 0 5px 0;">
                                                                            ${discount20Percentage} % Offered Discount!</p>
                                                                        <p style="font-family: monospace; font-size: 16px; font-weight: bold; color: #000; margin: 0 0 8px 0; letter-spacing: 1px;">
                                                                            ${coupon20Code}</p>
                                                                        <p style="font-size: 12px; color: #6b7280; margin: 0 0 5px 0;">
                                                                            ${countdownTimerUrl ? `Ends soon <img src="${countdownTimerUrl}" alt="Timer" width="100" style="display:inline-block; vertical-align:middle; margin-left:8px; height:auto; max-width:100px;" />` : `Ends in ⏳ ${countdown20}`}
                                                                        </p>
                                                                        <p style="font-size: 11px; color: #666; margin: 5px 0 12px 0;">
                                                                            Save <b>£${(originalTotal - discountedTotal20).toFixed(2)}</b> on this Order${minFeeApplied20 ? ` <span style="font-size: 10px; color: #f59e0b;">*Min fee £45 applies</span>` : ''}<br /><a href="https://www.londonwastemanagement.com/terms-conditions/" style="font-size: 9px; color: #666; text-decoration: underline;">*Terms & conditions</a></p>
                                                                        <table width="100%">
                                                                            <tr>
                                                                                <td align="center" style="border: 1px solid #4CAF50; border-radius: 20px; padding: 8px;">
                                                                                    <a href="${applyCodeUrl20}" style="text-decoration: none; color: #4CAF50; font-weight: bold; font-size: 12px; display: block;">Apply Code</a>
                                                                                </td>
                                                                            </tr>
                                                                        </table>
                                                                    </td>
                                                                </tr>
                                                            </table>
                                                        </td>
                                                    </tr>
                                                </table>
                                            </td>
                                        </tr>

                                        <!-- Curved Wave Shape -->
                                        <tr>
                                            <td align="center" style="background-color: transparent; line-height: 0; font-size: 0; margin: 0; padding: 0; padding-top: 15px; width: 100%;">
                                                <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 80' preserveAspectRatio='none'%3E%3Cpath d='M0,0 Q300,80 600,0 L600,80 L0,80 Z' fill='%23ffffff'/%3E%3C/svg%3E" alt="" width="100%" height="80" style="display: block; width: 100%; height: auto; margin: 0; padding: 0;" />
                                            </td>
                                        </tr>

                                        <!-- 10% Coupon - in white section -->
                                        <tr>
                                            <td align="center" style="background-color: #ffffff; padding: 0 40px;">
                                                <table border="0" cellpadding="0" cellspacing="0" width="240" class="small-coupon" style="max-width: 240px; border: 1px solid #eee; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); background-color: #ffffff; margin-top: -65px; position: relative; z-index: 10;">
                                                    <tr>
                                                        <td width="30" align="center" style="border-right: 1px dashed #ddd; vertical-align: middle;">
                                                            <p style="font-size: 9px; color: #aaa; margin: 0; padding: 5px; writing-mode: vertical-rl; transform: rotate(180deg);">
                                                                ${discount10Percentage}%</p>
                                                        </td>
                                                        <td style="padding: 10px;">
                                                            <p style="font-weight: bold; font-size: 13px; margin: 0 0 5px 0;">
                                                                ${coupon10Code}</p>
                                                            <a href="${applyCodeUrl10}" style="border: 1px solid #4CAF50; padding: 4px 12px; border-radius: 12px; color: #4CAF50; text-decoration: none; font-size: 10px; font-weight: bold; display: inline-block;">Apply Code</a>
                                                        </td>
                                                    </tr>
                                                </table>
                                            </td>
                                        </tr>

                                        <!-- White Content Section -->
                                        <tr>
                                            <td align="center" style="padding: 20px 40px 20px 40px; background-color: #ffffff;">
                                                <h2 style="font-size: 22px; margin: 0 0 10px 0;">This Offer Is Limited</h2>
                                                <p style="font-size: 14px; color: #777; line-height: 1.5; margin: 0 0 20px 0;">
                                                    Don't miss out. If you have any questions,<br />
                                                    just reply, we're here to help.
                                                </p>
                                                <p style="font-size: 13px; color: #4CAF50; line-height: 1.4; margin: 0;">
                                                    Take advantage of your ${discount10Percentage}% discount<br />
                                                 
                                                </p>
                                            </td>
                                        </tr>

                                        <!-- Footer Bar -->
                                        <tr>
                                            <td style="padding: 20px 30px; border-top: 1px solid #eee; background-color: #ffffff;">
                                                <table width="100%">
                                                    <tr>
                                                        <td>
                                                            <table>
                                                                <tr>
                                                                    <td><img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1768385074/Profile_Picture_3_rjvnzp.png" width="30" style="border-radius: 30%;"></td>
                                                                    <td style="padding-left: 10px;">
                                                                        <p style="margin: 0; font-size: 12px; font-weight: bold; color: #333;">
                                                                            London Waste Management</p>
                                                                        <p style="margin: 0; font-size: 10px; color: #999;">
                                                                            Remove, Recycle & Upcycle</p>
                                                                    </td>
                                                                </tr>
                                                            </table>
                                                        </td>
                                                        <td align="right">
                                                            <!-- Socials -->
                                                            <a href="https://www.facebook.com/rubbishlovers" style="margin-left: 8px; text-decoration: none; display: inline-block;">
                                                                <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1768468200/samples/Group_5_r8avxw.png" alt="Facebook" width="24" height="24" style="display: block; border: 0;" />
                                                            </a>
                                                            <a href="https://www.instagram.com/londonwastemanagementuk/" style="margin-left: 8px; text-decoration: none; display: inline-block;">
                                                                <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1768468200/samples/Group_6_zilxrc.png" alt="Instagram" width="24" height="24" style="display: block; border: 0;" />
                                                            </a>
                                                            <a href="https://www.linkedin.com/company/londonwastemanagement" style="margin-left: 8px; text-decoration: none; display: inline-block;">
                                                                <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1768468200/samples/Group_7_ksbcqr.png" alt="LinkedIn" width="24" height="24" style="display: block; border: 0;" />
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

