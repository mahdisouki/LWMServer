const express = require("express");
const app = express();
require("dotenv").config();

// Trust proxy (nginx) to get real client IP
app.set('trust proxy', 1);
const http = require("http");
const bodyParser = require('body-parser');
const fs = require("fs");
const TippingPlace = require('./models/TippingPlaces')
const mongoose = require('mongoose')
const { initSocket } = require("./socket");
const connectToDatabase = require("./config/db");
const { sendWasteTransferNoteEmail, sendGeneralInvoiceEmail, sendPartialPaymentNotification, sendBookingConfirmationEmail } = require("./services/emailsService");
const { handleStripeWebhook } = require('./controllers/taskCtrl');
const helmet = require('helmet');

const server = http.createServer(app);
connectToDatabase()
  .then(async () => {
    console.log("✅ MongoDB Connected");

    const { loadExtraFreeEmailDomains } = require('./utils/businessEmail');
    const extraFreeDomainCount = await loadExtraFreeEmailDomains();
    console.log(`Free email domains loaded (${extraFreeDomainCount} extra)`);

    const MailSignature = require('./models/MailSignature');
    await MailSignature.dropLegacyIndexes();

    // ✅ Load your routes, middleware, jobs, etc.
    require('./jobs/dailySheetCron');
    require('./jobs/blueSheetCron');
    require('./cron/clearNotifications');
    require('./cron/clearChats');
    require('./cron/autoEndShifts');
    require('./cron/sendReviewEmails');
    require('./cron/refreshInstagramToken');
    require('./cron/checkQuotationReminders');
    require('./cron/deleteExpiredCoupons');
    require('./cron/sendRetargetingFailedTasks');
    require('./cron/gmailWatchRenew');
    require('./cron/gmailAssignmentIdle');
    require('./cron/scheduledEmailSender');
    require('./workers/paymentLinkRetryWorker');
    require('./cron/sendWasteTransferNotes');
    require('./cron/remindVanCapacityCheck');
    require('./cron/dayOffUnitReminders');
    require('./cron/subscriptionReminders');
    require('./cron/cleanupTaskPhotoUploads');
    require('./cron/updatePopularityScores');
    require('./cron/updateTopPostcodesCache');
    require('./cron/syncLsaOrderTrafficSources');

    const {
      startPendingClassificationWorker,
    } = require('./services/pendingClassificationWorker');
    await startPendingClassificationWorker();

    // sendBookingConfirmationEmail("67e1e4c301ba1a14b5f9eba5")

  })
  .catch(err => {
    console.error("❌ MongoDB Connection Failed:", err);
    process.exit(1); // Exit safely if DB connection fails
  });

// initSocket(server);

const cors = require("cors");
const path = require("path");

// Remove X-Powered-By header (hide Express identity)
app.disable('x-powered-by');

// Configure Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://*.stripe.com",
        "https://*.paypal.com",
        "https://*.paypalobjects.com",
        "'unsafe-inline'", // Only if absolutely necessary
        "'unsafe-eval'", // Only if absolutely necessary
        "blob:"
      ],
      styleSrc: [
        "'self'",
        "https://*.paypal.com",
        "https://*.paypalobjects.com",
        "'unsafe-inline'"
      ],
      imgSrc: [
        "'self'",
        "data:",
        "https://*.paypal.com",
        "https://*.paypalobjects.com",
        "https://res.cloudinary.com"
      ],
      frameSrc: [
        "https://*.stripe.com",
        "https://*.paypal.com"
      ],
      connectSrc: [
        "'self'",
        "https://*.stripe.com",
        "https://*.paypal.com"
      ],
      formAction: ["'self'"], // Fix: form-action missing
      baseUri: ["'self'"], // Fix: base-uri missing
      frameAncestors: ["'none'"], // Fix: frame-ancestors missing
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  hidePoweredBy: true, // Hide X-Powered-By
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));


const setupSwagger = require('./config/swaggerConfig');
// Apply raw body for Stripe webhook first



const corsOptions = {
  origin: ['https://dirverapp.netlify.app',
    'https://lwmadmin.netlify.app',
    'https://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3001',
    'http://localhost:5176',
    'https://adminlondonwaste.netlify.app',
    'http://localhost:5173',
    'http://localhost:5175',
    'https://admin.londonwastemanagement.uk',
    'https://driver.londonwastemanagement.uk',
    'https://client.londonwastemanagement.uk',
    'http://192.168.100.23:5173',
    "http://192.168.1.19:5173",
    'http://192.168.1.12:5173',
    'http://192.168.100.12:5173',
    'http://192.168.100.5:5173',
    'http://192.168.1.73:5173',
    'http://192.168.1.19:5173',
    'http://192.168.1.73:5173',
    'http://192.168.1.13:5173',
    'http://192.168.1.73:5174',
    'http://192.168.1.73:5176',
    'http://192.168.1.68:5174',
    'http://192.168.1.74:5173',
    'https://lwmclient.duckdns.org',
    'https://broker.londonwastemanagement.uk',
    'https://stagingadmin.londonwastemanagement.uk',
    'https://stagingadmin.londonwastemanagement.uk',
    'https://londonwastemanagement.com',
    'https://www.londonwastemanagement.com',
    'http://lwmtest-botest-lzlcjq-c53a95-191-101-81-116.traefik.me',
    'lwmtest-clienttest-ptkvge-7b883a-191-101-81-116.traefik.me',
    'http://lwmtest-clienttest-ptkvge-7b883a-191-101-81-116.traefik.me'
  ],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use('/public', express.static(path.join(__dirname, 'public')));
app.get('/public/:fileName', (req, res) => {
  const filePath = path.join(__dirname, 'public', req.params.fileName);
  if (fs.existsSync(filePath)) {
    res.download(filePath); // Envoie le fichier au client
  } else {
    res.status(404).send('File not found');
  }
});

// Stripe Webhook Route - Raw body middleware is applied ONLY for this route
app.post(
  '/api/webhooks/stripe',
  bodyParser.raw({ type: 'application/json' }),
  handleStripeWebhook
);

app.use(cors(corsOptions));
// Keep raw body for WhatsApp webhook signature verification
app.use(
  express.json({
    verify: (req, res, buf) => {
      if (req.originalUrl && req.originalUrl.startsWith('/api/whatsapp/webhook')) {
        req.rawBody = buf;
      }
    },
  })
);
app.use(bodyParser.json());
// Note: CSP is now handled by Helmet above, removed duplicate CSP header
// Import routes
const taskRouter = require("./routes/task");
const authRouter = require("./routes/auth");
const staffRouter = require("./routes/staff");
const truckRouter = require("./routes/truck");
const unitAssignmentLogRouter = require("./routes/unitAssignmentLog");
const driverRouter = require("./routes/driver");
const tippingRouter = require("./routes/tipping");
const dayoffRouter = require("./routes/dayoff");
const dailySheetRoutes = require("./routes/dailySheet");
const pcnDamageRoutes = require("./routes/pcnDamage");
const blueSheetRoutes = require("./routes/blueSheet");
const payrollsRoutes = require("./routes/payrolls");
const messageRoutes = require("./routes/messages");
const tippingPlacesRoutes = require('./routes/tippingPlaces')
const blockingDaysRoutes = require('./routes/blockingDays')
const standardItemsRoutes = require('./routes/standardItems')
const uploadRouter = require('./routes/upload');
const statsRoute = require("./routes/stats");
const gmailRoutes = require('./routes/gmail')
const webexRoutes = require('./routes/webex')
const refundRoutes = require('./routes/refund')
const paymentHistoRoutes = require('./routes/paymenthisto')
const blogRoutes = require('./routes/blog')
const storageRoutes = require('./routes/storage')
const quotationRoutes = require('./routes/quotationRoutes')
const contactRequestRoutes = require('./routes/contactRequestRoutes');
const serviceCategoryRoutes = require('./routes/serviceCategory');
const notificationRoutes = require('./routes/notification');
const incidentRoutes = require('./routes/incident');
const expenseRoutes = require('./routes/expense');
const subscriptionRoutes = require('./routes/subscription');
const whatsappRoutes = require('./routes/whatsapp');
const emailTemplateRoutes = require('./routes/emailTemplate');
const logRouter = require('./routes/log');
const customerRoutes = require('./routes/customerRoutes');
const feedbackRoutes = require('./routes/feedback');
const announcementRoutes = require('./routes/announcement');
const analyticsRoutes = require('./routes/analytics');
const couponRoutes = require('./routes/coupon');
const bookingHoldRoutes = require('./routes/bookingHold');
const instagramRoutes = require('./routes/instagram');
const routeOptimizerRoutes = require('./routes/routeOptimizer');
const vanRoutes = require('./routes/van');
const tickRoutes = require('./routes/tick');
const seoRoutes = require('./routes/seo');
const networkRouter = require('./routes/network');
const brokerRoutes = require('./routes/broker');
const brokerPortalRoutes = require('./routes/brokerPortal');
const labelingRoutes = require('./routes/labeling');
const tawkAttributionRoutes = require('./routes/tawkAttribution');
const mailtoAttributionRoutes = require('./routes/mailtoAttribution');
const { optimizeRoute } = require("./helper/OpitomRoute");

setupSwagger(app);
app.use("/api", taskRouter);
app.use('/api', authRouter);
app.use('/api', staffRouter);
app.use('/api', logRouter);
app.use('/api', truckRouter);
app.use('/api', unitAssignmentLogRouter);
app.use('/api', driverRouter);
app.use("/api", tippingRouter);
app.use("/api", dayoffRouter);
app.use("/api/dailySheets", dailySheetRoutes);
app.use("/api/route-optimizer", routeOptimizerRoutes);
app.use("/api/pcn-damages", pcnDamageRoutes);
app.use("/api/blueSheets", blueSheetRoutes);
app.use("/api", payrollsRoutes);
app.use("/api", messageRoutes);
app.use('/api/tippingPlaces', tippingPlacesRoutes);
app.use('/api/blockingDays', blockingDaysRoutes)
app.use('/api/standard', standardItemsRoutes)
app.use('/api/refund', refundRoutes)
app.use('/api/payment', paymentHistoRoutes)
app.use('/api/upload', uploadRouter)
app.use('/api', quotationRoutes);
app.use('/api/gmail', gmailRoutes);
app.use('/api/webex', webexRoutes);
app.use('/api/blog', blogRoutes);
app.use('/api', storageRoutes)
app.use('/api', statsRoute)
app.use('/api', contactRequestRoutes);
app.use('/api', serviceCategoryRoutes);
app.use('/api', notificationRoutes);
app.use('/api', emailTemplateRoutes)
app.use('/api/customers', customerRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/offers', bookingHoldRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api', incidentRoutes);
app.use('/api', vanRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/running-costs', require('./routes/runningCosts'));
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/ticks', tickRoutes);
app.use('/api/seo', seoRoutes);
app.use('/api', networkRouter);
app.use('/api/brokers', brokerRoutes);
app.use('/api/broker', brokerPortalRoutes);
app.use('/api/labeling', labelingRoutes);
app.use('/api', tawkAttributionRoutes);
app.use('/api', mailtoAttributionRoutes);
app.post('/optimise/:truckId', async (req, res) => {
  try {
    const { truckId } = req.params;
    console.log(truckId)
    const response = await optimizeRoute(truckId, "2024-12-03");
    res.json({ response: response })
  } catch (error) {
    console.log(error)
    res.json({ error: error })
  }
})

// startMailListener();

// Generic error handler - don't expose server details
app.use((err, req, res, next) => {
  console.error('Error:', err); // Log full error for debugging

  // Don't expose error details to client
  if (err.status === 405) {
    return res.status(405).json({
      message: 'Method not allowed'
    });
  }

  res.status(err.status || 500).json({
    message: err.message || 'An error occurred',
    // Don't include stack trace or error details in production
    ...(process.env.NODE_ENV === 'development' && { error: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    message: 'Resource not found'
  });
});

initSocket(server);

server.listen(process.env.port, () => {
  console.log(`LondonWaste app listening on port ${process.env.port}`);
});
