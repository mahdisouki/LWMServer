
const { sendEmail, fetchEmails } = require('../services/mailingService'); 

const gmailCtrl = {
  // Send an email using Nodemailer
  sendEmail: async (req, res) => {
    const { to, subject, text } = req.body;

    try {
      // Use the new mailing service to send an email
      const result = await sendEmail(to, subject, text);
      res.json({ message: 'Email sent successfully', result });
    } catch (error) {
      res.status(500).json({ message: 'Failed to send email', error: error.message });
    }
  },

 
  listEmails: async (req, res) => {
    try {
      const emails = await fetchEmails(); // Await the promise returned by fetchEmails
      res.json({ emails }); // Send the emails in the response
    } catch (err) {
      res.status(500).json({ message: 'Failed to retrieve emails', error: err.message });
    }
  },
  // Optionally, if you want to integrate some sort of fetching method for attachments or extra details:
  listEmailDetails: (req, res) => {
    const { emailId } = req.params;
    
    fetchEmails((err, emails) => {
      if (err) {
        return res.status(500).json({ message: 'Failed to retrieve emails', error: err.message });
      }

      // Find the specific email by ID (just for example)
      const email = emails.find(email => email.id === emailId);
      
      if (!email) {
        return res.status(404).json({ message: 'Email not found' });
      }

      res.json({ email });
    });
  },
};

module.exports = gmailCtrl;
