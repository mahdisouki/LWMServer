const router = require('express').Router();
const emailTemplateCtrl = require('../controllers/emailTemplateCtrl');
const { isAuth } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/role');


router.post('/email-templates', isAuth, checkRole('Admin'), emailTemplateCtrl.createTemplate);
router.get('/email-templates', isAuth, checkRole('Admin'), emailTemplateCtrl.getAllTemplates);
router.put('/email-templates/:id', isAuth, checkRole('Admin'), emailTemplateCtrl.updateTemplate);
router.get('/email-templates/:name', isAuth, checkRole('Admin'), emailTemplateCtrl.getTemplateByName);

module.exports = router;
