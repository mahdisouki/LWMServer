// controllers/contactRequestController.js
const ContactRequest = require('../models/ContactRequest');
const sendContactEmail = require('../utils/sendContactEmail');

const createContactRequest = async (req, res) => {
  try {
    const { fullName, email, message } = req.body;

    // Save the contact request to the database
    const newContact = new ContactRequest({ fullName, email, message });
    await newContact.save();

    // Send emails: to the responsible person and the user
    await sendContactEmail({
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
