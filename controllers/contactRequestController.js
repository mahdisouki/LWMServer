// controllers/contactRequestController.js
const ContactRequest = require('../models/ContactRequest');
const sendContact2Email = require('../utils/sendContact2Email');
const { normalizeUtmSource } = require('../utils/trafficSource');

const createContactRequest = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      subject,
      message,
      gclid,
      gbraid,
      wbraid,
      msclkid,
      fbclid,
      utm_source,
    } = req.body;

    const normalizedUtmSource = normalizeUtmSource(utm_source);

    // Save the contact request to the database (incl. ads click IDs from the client)
    const newContact = new ContactRequest({
      firstName,
      lastName,
      email,
      phone,
      subject,
      message,
      ...(gclid ? { gclid: String(gclid).trim() } : {}),
      ...(gbraid ? { gbraid: String(gbraid).trim() } : {}),
      ...(wbraid ? { wbraid: String(wbraid).trim() } : {}),
      ...(msclkid ? { msclkid: String(msclkid).trim() } : {}),
      ...(fbclid ? { fbclid: String(fbclid).trim() } : {}),
      ...(normalizedUtmSource ? { utm_source: normalizedUtmSource } : {}),
    });
    await newContact.save();

    // Send emails: to the responsible person and the user
    await sendContact2Email({
      responsibleEmail: process.env.RESPONSIBLE_EMAIL,
      contactData: newContact,
    });

    res.status(201).json({ message: "Contact request submitted successfully", contact: newContact });
  } catch (error) {
    console.error('Error creating contact request:', error);
    res.status(500).json({ message: "Failed to submit contact request", error: error.message });
  }
};

const getAllContactRequests = async (req, res) => {
  try {
    const contacts = await ContactRequest.find();
    res.status(200).json(contacts);
  } catch (error) {
    res.status(500).json({ message: "Failed to retrieve contact requests", error: error.message });
  }
};

const getContactRequestById = async (req, res) => {
  try {
    const { id } = req.params;
    const contact = await ContactRequest.findById(id);
    if (!contact) {
      return res.status(404).json({ message: "Contact request not found" });
    }
    res.status(200).json(contact);
  } catch (error) {
    res.status(500).json({ message: "Failed to retrieve contact request", error: error.message });
  }
};

module.exports = { createContactRequest, getAllContactRequests, getContactRequestById };
