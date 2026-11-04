const yeastar = require('../services/yeastar/yeastarService');

function handleError(res, err, fallback = 'Yeastar error') {
  const status = err.status || err.statusCode || 500;
  console.error('[Yeastar]', err.message);
  return res.status(status).json({
    success: false,
    message: err.message || fallback,
  });
}

exports.getStatus = async (req, res) => {
  try {
    const config = yeastar.getConfig();
    return res.json({
      success: true,
      configured: yeastar.isConfigured(),
      baseUrl: config.baseUrl,
      extension: config.extension,
      extensionName: config.extensionName,
      setupHint: yeastar.isConfigured()
        ? null
        : 'Set YEASTAR_CLIENT_ID and YEASTAR_CLIENT_SECRET in the server environment',
    });
  } catch (err) {
    return handleError(res, err);
  }
};

exports.listExtensions = async (req, res) => {
  try {
    const result = await yeastar.listExtensions();
    const config = yeastar.getConfig();
    const selected = result.extensions.find((row) => String(row.number) === config.extension) || null;
    return res.json({
      success: true,
      extension: config.extension,
      extensionName: config.extensionName,
      selected,
      total: result.total,
      extensions: result.extensions,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

exports.dial = async (req, res) => {
  try {
    const callee = req.body?.callee || req.body?.phoneNumber || req.body?.number;
    const call = await yeastar.dial({
      callee,
      caller: req.body?.caller,
      autoAnswer: req.body?.autoAnswer === true || req.body?.autoAnswer === 'yes',
    });
    return res.json({ success: true, call });
  } catch (err) {
    return handleError(res, err);
  }
};
