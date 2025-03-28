const router = require('express').Router();
const emailTemplateCtrl = require('../controllers/emailTemplateCtrl');

router.post('/email-templates', emailTemplateCtrl.createTemplate);
router.get('/email-templates', emailTemplateCtrl.getAllTemplates);
router.get('/email-templates/:name', emailTemplateCtrl.getTemplateByName);

module.exports = router;
