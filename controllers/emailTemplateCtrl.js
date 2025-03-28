const EmailTemplate = require('../models/emailTemplate');

const emailTemplateCtrl = {
  createTemplate: async (req, res) => {
    const { name, body, variables } = req.body;
    try {
      const template = await EmailTemplate.create({ name, body, variables });
      res.status(201).json({ message: "Template created", data: template });
    } catch (error) {
      res.status(500).json({ message: "Failed to create template", error: error.message });
    }
  },

  getAllTemplates: async (req, res) => {
    try {
      const templates = await EmailTemplate.find().sort({ createdAt: -1 });
      res.status(200).json({ data: templates });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch templates", error: error.message });
    }
  },

  getTemplateByName: async (req, res) => {
    try {
      const template = await EmailTemplate.findOne({ name: req.params.name });
      if (!template) return res.status(404).json({ message: "Template not found" });
      res.status(200).json({ data: template });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch template", error: error.message });
    }
  }
};

module.exports = emailTemplateCtrl;
