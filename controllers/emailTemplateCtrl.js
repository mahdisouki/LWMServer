const EmailTemplate = require('../models/emailTemplate');
const mongoose = require('mongoose');

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
  },

  updateTemplate: async (req, res) => {
    const { id } = req.params;
    const { name, body, variables } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid template id" });
    }

    const updates = {};
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) {
        return res.status(400).json({ message: "name cannot be empty" });
      }
      updates.name = trimmed;
    }
    if (body !== undefined) {
      if (String(body).trim() === "") {
        return res.status(400).json({ message: "body cannot be empty" });
      }
      updates.body = body;
    }
    if (variables !== undefined) {
      if (!Array.isArray(variables)) {
        return res.status(400).json({ message: "variables must be an array" });
      }
      updates.variables = variables;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message: "At least one of name, body, or variables is required",
      });
    }

    try {
      const template = await EmailTemplate.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true, runValidators: true }
      );
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      res.status(200).json({ message: "Template updated", data: template });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({
          message: "A template with this name already exists",
          error: error.message,
        });
      }
      res.status(500).json({ message: "Failed to update template", error: error.message });
    }
  },
};

module.exports = emailTemplateCtrl;
