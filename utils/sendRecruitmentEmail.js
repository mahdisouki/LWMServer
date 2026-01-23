const nodemailer = require('nodemailer');
const { addStagingToSubject, addStagingBanner } = require('./emailHelpers');

const sendRecruitmentEmail = async ({ responsibleEmail, contactData }) => {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD,
        },
    });

    // Helper function to detect if URL is a video
    const isVideoUrl = (url) => {
        const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv'];
        const lowerUrl = url.toLowerCase();
        return videoExtensions.some(ext => lowerUrl.includes(ext)) || lowerUrl.includes('/video/');
    };

    // Generate CV attachment info HTML
    let cvInfoHTML = '';
    if (contactData.cvFile) {
        cvInfoHTML = `
      <h3 style="margin-top: 20px; margin-bottom: 10px; color: #4CAF50;">CV Uploaded:</h3>
      <div style="padding: 10px; background-color: #f5f5f5; border-radius: 4px; border: 1px solid #ddd; margin-top: 10px;">
        <p style="margin: 5px 0;"><a href="${contactData.cvFile}" target="_blank" style="color: #4CAF50; text-decoration: none;">View CV</a></p>
      </div>`;
    }

    // Email to the responsible person
    const mailOptionsToResponsible = {
        from: `"London Waste Management" <${contactData.email}>`,
        to: responsibleEmail,
        replyTo: contactData.email,
        subject: addStagingToSubject(`New Recruitment Application from ${contactData.fullName}`),
        html: addStagingBanner(`
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; border: 1px solid #ddd; border-radius: 8px; padding: 20px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1762522796/omar%27s%20new/Logo_wwspkm.png" alt="London Waste Management" style="max-width: 150px;">
      </div>
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #4CAF50;">New Recruitment Application</h2>
        <p style="font-size: 14px; color: #888;">A candidate has submitted a job application.</p>
      </div>
      <div style="padding: 15px; background-color: #fff; border-radius: 8px; border: 1px solid #ddd;">
        <p style="margin: 10px 0; font-size: 16px;"><strong>Full Name:</strong> ${contactData.fullName}</p>
        <p style="margin: 10px 0; font-size: 16px;"><strong>Email:</strong> ${contactData.email}</p>
        <p style="margin: 10px 0; font-size: 16px;"><strong>Phone Number:</strong> ${contactData.phoneNumber}</p>
        <p style="margin: 10px 0; font-size: 16px;"><strong>Role of Interest:</strong> ${contactData.roleOfInterest}</p>
        <p style="margin: 10px 0; font-size: 16px;"><strong>Experience Level:</strong> ${contactData.experienceLevel}</p>
        ${contactData.message ? `<p style="margin: 10px 0; font-size: 16px;"><strong>Message:</strong></p>
        <div style="margin: 10px 0; padding: 10px; background-color: #f5f5f5; border-radius: 4px; border-left: 4px solid #4CAF50;">
          ${contactData.message.replace(/\n/g, '<br>')}
        </div>` : ''}
        ${cvInfoHTML}
      </div>
      <div style="text-align: center; margin-top: 20px;">
        <p style="font-size: 14px; color: #888;">London Waste Management</p>
      </div>
    </div>
  `),
    };

    // Email to the user (confirmation)
    const mailOptionsToUser = {
        from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
        to: contactData.email,
        subject: 'Thank You for Your Interest in Joining Our Team!',
        html: `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
            .section { padding: 0; }
            .main-table { width: 600px; max-width: 600px; }
            .content-card { padding: 40px 48px 42px; }
            .content-wrapper { padding: 0; }
            .inner-content-box { padding: 32px; }
            @media only screen and (max-width: 620px) {
              .main-table { width: 100% !important; max-width: 100% !important; }
              .content-card { padding: 24px !important; }
              .hero { padding: 0 !important; }
              .hero img { width: 100% !important; max-width: 100% !important; display: block !important; }
              .content-wrapper { padding: 0 16px !important; }
              .section:not(.hero) { padding: 0 16px 24px !important; }
              .thankyou { padding: 24px 16px 16px !important; }
              .inner-content-box { padding: 24px !important; }
            }
          </style>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="100%" class="main-table" style="border-collapse: collapse; margin: 0 auto; padding: 0; width: 100%; max-width: 600px; background: #ffffff;">
            <tr>
              <td class="section hero" style="padding: 0; line-height: 0;" align="center">
                <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1766528514/Group_1261156245_ngvccs.png" alt="London Waste Management" width="600" style="display: block; width: 600px; max-width: 100%; height: auto; margin: 0; border: 0; line-height: 0;" />
              </td>
            </tr>
            <tr>
              <td class="section thankyou" style="padding: 24px 0 16px; text-align: center;">
                <p style="margin: 0; font-size: 26px; font-weight: 700; color: #111;">
                  <span style="color: #c5f3c3; font-size: 34px;">"</span>
                  Thank You !
                  <span style="color: #c5f3c3; font-size: 34px;">"</span>
                </p>
              </td>
            </tr>
            <tr>
              <td class="section content-wrapper" style="padding: 0 0 34px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border: none;">
                  <tr>
                    <td class="content-card" style="color: #232b25; background: #ffffff; padding: 40px 48px 42px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="box-shadow: 0 4px 20px rgba(0,0,0,0.12); border-radius: 8px; background: #ffffff;">
                        <tr>
                          <td class="inner-content-box" style="padding: 32px;">
                            <p style="font-size: 22px; font-weight: 700; margin: 0 0 8px;">
                              <span style="color: #000000;">Dear</span>
                              <span style="color: #111111;"> ${contactData.fullName},</span>
                            </p>
                            <div style="width: 92px; height: 5px; background: #28c152; margin: 0 0 24px;"></div>
                            <p style="font-size: 17px; line-height: 1.8; margin: 0 0 18px; color: #374237;">
                              Thank you for your interest in joining our team. We have received your application and will review it carefully.
                            </p>
                            <p style="font-size: 17px; line-height: 1.8; margin: 0 0 22px; color: #374237;">
                              If your profile matches our requirements, we will contact you soon.
                          
                            </p>
                            <p style="font-size: 15px; margin: 24px 0 4px; color: #4f5b52;">Best regards,</p>
                            <p style="font-size: 16px; font-weight: bold; color: #169b4f; margin: 0;">London Waste Management HR Department</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 16px 24px; text-align: center; font-size: 12px; color: #5f6b66; border-top: 1px solid #e5f3e1;">
                London Waste Management &nbsp;|&nbsp;
                <a href="mailto:hello@londonwastemanagement.com" style="color: #169b4f; text-decoration: none;">hello@londonwastemanagement.com</a>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
    };

    // Send both emails
    await transporter.sendMail(mailOptionsToResponsible);
    await transporter.sendMail(mailOptionsToUser);
};

module.exports = sendRecruitmentEmail;

