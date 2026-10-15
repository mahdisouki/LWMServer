const FormData = require('form-data');
const axios = require('axios');
const sharp = require('sharp');
const LabelClass = require('../models/LabelClass');
const LabelingJob = require('../models/LabelingJob');
const LabeledImage = require('../models/LabeledImage');
const QuotationRequest = require('../models/QuotationRequest');
const Task = require('../models/Task');
const AdditionalItemRequest = require('../models/AdditionalItemRequest');

// Canonical order from item-detection/data_filtered.yaml (nc: 76). Do not reorder.
const DEFAULT_YOLO_CLASSES = [
  '2 seater sofa',
  '3 seater sofa',
  'American double fridge',
  'Armchair',
  'BBQ',
  'Bathtub',
  'Bed with matress',
  'Bedside table',
  'Bike',
  'Bin',
  'Book',
  'Bookshelf',
  'Bricks',
  'Car Battery',
  'Chest freezer',
  'Chest of drawers',
  'Coffee machine',
  'Commercial fridge',
  'Computer',
  'Cooker hood',
  'Corner sofa',
  'Cot',
  'Desk',
  'Dinning chair',
  'Dinning table',
  'Dishwasher',
  'Double bed frame',
  'Double cooker',
  'Double matresse',
  'Dvd Players - Sky Box',
  'Exercice bike',
  'External door',
  'Fan',
  'Footstool',
  'Garden chair',
  'Garden table',
  'Hob Cooker',
  'Iron',
  'Ironing board',
  'Kettle',
  'Keyboard',
  'Lamp',
  'Laptop',
  'Lawnmower',
  'Microwave',
  'Mini fridge',
  'Mouse',
  'Office chair',
  'Office printer',
  'Oven',
  'Paint cans',
  'Parasol',
  'Plant',
  'Pool',
  'Pot',
  'Printer',
  'Radiator',
  'Radio',
  'Sewing machine',
  'Shower tray',
  'Single bed frame',
  'Sink',
  'Standard fridge freezer',
  'Storage heater',
  'Suitcase',
  'TV',
  'Toaster',
  'Toilet',
  'Treadmill',
  'Vaccum',
  'Washing machine OR Tumble dryer',
  'Waste bag',
  'Window',
  'Wooden door',
  'Wooden pallet',
  'single matress',
];

const VIDEO_EXT_RE = /\.(mp4|webm|ogg|mov|avi|m4v)(\?|$)/i;
const HTTP_IMAGE_QUERY = { $regex: /^https?:\/\// };
// New classes appended after the frozen filtered model order on export.
// category:'load' is back-office UI only — in YOLO they are normal class names.
const LOAD_SIZES = ['1/4 Load', '1/2 Load', '3/4 Load', 'Full Load'];
const REMOVED_HELPER_CLASSES = ['Sofa', 'Chair', 'Table'];

function getYoloPredictUrl() {
  return process.env.YOLO_PREDICT_URL || 'http://127.0.0.1:8002/detect';
}

function isLabelingImageUrl(value) {
  if (!value || typeof value !== 'string') return false;
  if (!value.startsWith('http://') && !value.startsWith('https://')) return false;
  if (VIDEO_EXT_RE.test(value)) return false;
  return true;
}

function customerNameFromTask(task) {
  return [task.firstName, task.lastName].filter(Boolean).join(' ').trim();
}

function collectGroupPhotoUrls(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((group) => (Array.isArray(group?.items) ? group.items : []));
}

function collectTaskImageUrls(task, extraUrls = []) {
  const urls = [
    ...(Array.isArray(task.clientObjectPhotos) ? task.clientObjectPhotos : []),
    ...collectGroupPhotoUrls(task.additionalItems),
    ...extraUrls,
  ];
  return [...new Set(urls.filter(isLabelingImageUrl))];
}

async function ensureIndexes() {
  const indexes = await LabelingJob.collection.indexes();
  const legacy = indexes.find((index) => index.name === 'quotationId_1_imageUrl_1');
  if (legacy) {
    await LabelingJob.collection.dropIndex('quotationId_1_imageUrl_1');
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function percentBoxToYolo(box) {
  return {
    x: (Number(box.x) + Number(box.width) / 2) / 100,
    y: (Number(box.y) + Number(box.height) / 2) / 100,
    width: Number(box.width) / 100,
    height: Number(box.height) / 100,
    label: box.label,
    score: box.score,
    source: box.source || 'human',
  };
}

function toYoloBox(box) {
  const next = {
    x: Number(box.x),
    y: Number(box.y),
    width: Number(box.width),
    height: Number(box.height),
    label: String(box.label).trim(),
    score: typeof box.score === 'number' ? box.score : undefined,
    source: box.source === 'yolo' ? 'yolo' : 'human',
  };
  return {
    ...next,
    x: clamp(next.x, 0, 1),
    y: clamp(next.y, 0, 1),
    width: clamp(next.width, 0.0001, 1),
    height: clamp(next.height, 0.0001, 1),
  };
}

async function migrateDocumentBoxes(Model) {
  const docs = await Model.find({
    boxes: {
      $elemMatch: {
        $or: [
          { width: { $gt: 1 } },
          { height: { $gt: 1 } },
          { x: { $gt: 1 } },
          { y: { $gt: 1 } },
        ],
      },
    },
  });
  await Promise.all(
    docs.map((doc) => {
      doc.boxes = doc.boxes.map((box) => toYoloBox(percentBoxToYolo(box)));
      return doc.save();
    }),
  );
}

async function migrateBoxesToYolo() {
  await migrateDocumentBoxes(LabelingJob);
  await migrateDocumentBoxes(LabeledImage);
}

async function ensureDefaultClasses() {
  await ensureIndexes();
  await migrateBoxesToYolo();
  await LabelClass.deleteMany({ name: { $in: REMOVED_HELPER_CLASSES } });

  const reservedEnd = DEFAULT_YOLO_CLASSES.length + LOAD_SIZES.length;
  // Keep 0..(reservedEnd-1) free for filtered model + load classes only.
  await LabelClass.updateMany(
    {
      name: { $nin: [...DEFAULT_YOLO_CLASSES, ...LOAD_SIZES] },
      yoloIndex: { $type: 'number', $lt: reservedEnd },
    },
    { $set: { yoloIndex: null } },
  );

  const defaultClasses = [
    ...DEFAULT_YOLO_CLASSES.map((name, yoloIndex) => ({
      name,
      isYoloClass: true,
      category: 'item',
      yoloIndex,
    })),
    ...LOAD_SIZES.map((name, offset) => ({
      name,
      isYoloClass: true,
      category: 'load',
      yoloIndex: DEFAULT_YOLO_CLASSES.length + offset,
    })),
  ];
  const ops = defaultClasses.map((item) => ({
    updateOne: {
      filter: { name: item.name },
      update: {
        $setOnInsert: { name: item.name },
        $set: {
          category: item.category,
          isYoloClass: item.isYoloClass,
          yoloIndex: item.yoloIndex,
        },
      },
      upsert: true,
    },
  }));
  await LabelClass.bulkWrite(ops);
  await LabelClass.updateMany(
    { $or: [{ category: { $exists: false } }, { category: null }] },
    { $set: { category: 'item' } },
  );
  // Classes present in data.yaml but dropped from data_filtered.yaml.
  await LabelClass.updateMany(
    {
      name: {
        $in: ['Concrete Slabs', 'Cooker-Oven', 'Fluorescent tube', 'Monitorscreen'],
      },
    },
    { $set: { isYoloClass: false, yoloIndex: null } },
  );

  // Any extra YOLO classes added via UI without an index yet — append in created order.
  await assignMissingYoloIndexes();
}

async function nextYoloIndex() {
  const reservedEnd = DEFAULT_YOLO_CLASSES.length + LOAD_SIZES.length;
  const maxDoc = await LabelClass.findOne({ yoloIndex: { $type: 'number' } })
    .sort({ yoloIndex: -1 })
    .select('yoloIndex')
    .lean();
  if (!maxDoc || typeof maxDoc.yoloIndex !== 'number') return reservedEnd;
  return Math.max(reservedEnd, maxDoc.yoloIndex + 1);
}

async function assignMissingYoloIndexes() {
  const missing = await LabelClass.find({
    isYoloClass: true,
    $or: [{ yoloIndex: null }, { yoloIndex: { $exists: false } }],
  }).sort({ createdAt: 1 });
  if (!missing.length) return;

  let next = await nextYoloIndex();
  for (const doc of missing) {
    doc.yoloIndex = next;
    await doc.save();
    next += 1;
  }
}

/**
 * Canonical YOLO class order for expand → export → update yaml → retrain.
 * Indices 0..75 stay locked to data_filtered.yaml (flat class list, no categories).
 * Loads / Add-class names are simply more classes at 76+.
 */
function yoloClassNames(classes = []) {
  return classes
    .filter(
      (item) =>
        item
        && item.isYoloClass
        && item.name
        && typeof item.yoloIndex === 'number',
    )
    .sort((a, b) => a.yoloIndex - b.yoloIndex)
    .map((item) => item.name);
}

/**
 * Flat YOLO names block matching Roboflow/Ultralytics style (no item/load categories).
 * category on LabelClass is back-office UI only.
 */
function buildDataYamlNames(names) {
  return [
    `nc: ${names.length}`,
    'names:',
    ...names.map((name) => `- ${toYamlScalar(name)}`),
  ].join('\n');
}

function toYamlScalar(value) {
  const text = String(value);
  if (/[:#{}[\],&*?|<>=!%@`'"]/.test(text) || text !== text.trim()) {
    return JSON.stringify(text);
  }
  return text;
}

function extensionFromContentType(contentType) {
  if (typeof contentType !== 'string') return '.jpg';
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('gif')) return '.gif';
  return '.jpg';
}

function mapDetectApiBoxes(detections, imageWidth, imageHeight) {
  return detections.map((detection) => {
    const label = String(detection?.class || '').trim();
    const bbox = detection?.bbox || {};
    const x1 = Number(bbox.x1);
    const y1 = Number(bbox.y1);
    const x2 = Number(bbox.x2);
    const y2 = Number(bbox.y2);
    if (
      !label
      || !Number.isFinite(x1)
      || !Number.isFinite(y1)
      || !Number.isFinite(x2)
      || !Number.isFinite(y2)
    ) {
      throw new Error('YOLO detect returned an invalid detection');
    }

    const widthPx = x2 - x1;
    const heightPx = y2 - y1;
    if (widthPx <= 0 || heightPx <= 0) {
      throw new Error('YOLO detect returned an invalid bounding box');
    }

    return toYoloBox({
      x: ((x1 + x2) / 2) / imageWidth,
      y: ((y1 + y2) / 2) / imageHeight,
      width: widthPx / imageWidth,
      height: heightPx / imageHeight,
      label,
      score: typeof detection.confidence === 'number' ? detection.confidence : undefined,
      source: 'yolo',
    });
  });
}

function detectUrlWithNoAnnotate(predictUrl) {
  const separator = predictUrl.includes('?') ? '&' : '?';
  return `${predictUrl}${separator}annotate=false`;
}

async function predictBoxes(imageUrl) {
  const imageResponse = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 60000,
    maxContentLength: Infinity,
  });

  const buffer = Buffer.from(imageResponse.data);
  const imageMeta = await sharp(buffer).metadata();
  const imageWidth = Number(imageMeta.width);
  const imageHeight = Number(imageMeta.height);
  if (!imageWidth || !imageHeight) {
    throw new Error('Could not read image width and height for YOLO detect');
  }

  const contentType = imageResponse.headers['content-type'] || 'image/jpeg';
  const form = new FormData();
  form.append('image', buffer, {
    filename: `detect${extensionFromContentType(contentType)}`,
    contentType,
  });

  const response = await axios.post(detectUrlWithNoAnnotate(getYoloPredictUrl()), form, {
    headers: form.getHeaders(),
    timeout: 60000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  const payload = response.data;
  if (!payload || !Array.isArray(payload.detections)) {
    throw new Error('YOLO detect returned an unexpected response');
  }

  const boxes = mapDetectApiBoxes(payload.detections, imageWidth, imageHeight);
  // Do not invent new class ids from predictions — only the filtered model / UI Add class may.
  return boxes;
}

async function enqueueImageJobs({ source, quotationId, taskId, orderNumber, customerName, email, imageUrls }) {
  const urls = [...new Set((imageUrls || []).filter(isLabelingImageUrl))];
  if (urls.length === 0) {
    return { created: 0 };
  }

  const ops = urls.map((imageUrl) => ({
    updateOne: {
      filter: { imageUrl },
      update: {
        $setOnInsert: {
          source,
          quotationId: quotationId || null,
          taskId: taskId || null,
          orderNumber: orderNumber || '',
          imageUrl,
          customerName: customerName || '',
          email: email || '',
          status: 'pending',
        },
      },
      upsert: true,
    },
  }));

  const result = await LabelingJob.bulkWrite(ops);
  return { created: result.upsertedCount || 0 };
}

async function enqueueQuotationImages(quotation) {
  if (!quotation || !Array.isArray(quotation.items)) {
    return { created: 0 };
  }

  return enqueueImageJobs({
    source: 'quotation',
    quotationId: quotation._id,
    customerName: quotation.Name || '',
    email: quotation.email || '',
    imageUrls: quotation.items,
  });
}

async function enqueueTaskImages(task, extraUrls = []) {
  if (!task) {
    return { created: 0 };
  }

  return enqueueImageJobs({
    source: 'order',
    taskId: task._id,
    orderNumber: task.orderNumber ? String(task.orderNumber) : '',
    customerName: customerNameFromTask(task),
    email: task.email || '',
    imageUrls: collectTaskImageUrls(task, extraUrls),
  });
}

async function syncJobsFromQuotations() {
  const quotations = await QuotationRequest.find({
    items: { $elemMatch: HTTP_IMAGE_QUERY },
  })
    .select('_id Name email items')
    .lean();

  let created = 0;
  for (const quotation of quotations) {
    const result = await enqueueQuotationImages(quotation);
    created += result.created;
  }
  return { scanned: quotations.length, created };
}

async function syncJobsFromOrders() {
  const tasks = await Task.find({
    $or: [
      { clientObjectPhotos: { $elemMatch: HTTP_IMAGE_QUERY } },
      { 'additionalItems.items': HTTP_IMAGE_QUERY },
    ],
  })
    .select(
      '_id firstName lastName email orderNumber clientObjectPhotos additionalItems'
    )
    .lean();

  let created = 0;
  for (const task of tasks) {
    const result = await enqueueTaskImages(task);
    created += result.created;
  }

  const extraRequests = await AdditionalItemRequest.find({
    media: { $elemMatch: HTTP_IMAGE_QUERY },
  })
    .select('parentTaskId media')
    .lean();

  const taskIds = [
    ...new Set(
      extraRequests
        .map((request) => request.parentTaskId)
        .filter(Boolean)
        .map((id) => String(id))
    ),
  ];
  const parentTasks = await Task.find({ _id: { $in: taskIds } })
    .select('_id firstName lastName email orderNumber')
    .lean();
  const parentById = new Map(parentTasks.map((task) => [String(task._id), task]));

  for (const request of extraRequests) {
    const parent = parentById.get(String(request.parentTaskId));
    if (!parent) continue;
    const result = await enqueueImageJobs({
      source: 'order',
      taskId: parent._id,
      orderNumber: parent.orderNumber ? String(parent.orderNumber) : '',
      customerName: customerNameFromTask(parent),
      email: parent.email || '',
      imageUrls: request.media,
    });
    created += result.created;
  }

  return { scanned: tasks.length, created };
}

async function syncAllLabelingJobs() {
  const quotations = await syncJobsFromQuotations();
  const orders = await syncJobsFromOrders();
  return {
    scannedQuotations: quotations.scanned,
    scannedOrders: orders.scanned,
    created: quotations.created + orders.created,
  };
}

function toYoloRow(box, classIndex) {
  return `${classIndex} ${box.x} ${box.y} ${box.width} ${box.height}`;
}

function isPublishableJob(job) {
  if (!job || !Array.isArray(job.boxes) || job.boxes.length === 0) return false;
  const label = job.label || job.loadSize;
  if (!label) return false;
  if (job.category === 'load' && !LOAD_SIZES.includes(label)) return false;
  return true;
}

function labeledImagePayload(job, userId) {
  const label = job.label || job.loadSize;
  const category = job.category === 'load' || LOAD_SIZES.includes(label)
    ? 'load'
    : 'item';
  return {
    jobId: job._id,
    source: job.source || 'quotation',
    quotationId: job.quotationId || null,
    taskId: job.taskId || null,
    orderNumber: job.orderNumber || '',
    imageUrl: job.imageUrl,
    customerName: job.customerName || '',
    email: job.email || '',
    category,
    label,
    loadSize: LOAD_SIZES.includes(label) ? label : null,
    boxes: job.boxes.map((box) => ({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      label: box.label,
      score: box.score,
      source: box.source || 'human',
    })),
    labeledBy: userId || job.labeledBy || null,
    labeledAt: job.labeledAt || new Date(),
  };
}

async function publishLabeledImage(job, userId) {
  if (!isPublishableJob(job)) {
    await LabeledImage.deleteOne({
      $or: [{ jobId: job._id }, { imageUrl: job.imageUrl }],
    });
    return null;
  }

  return LabeledImage.findOneAndUpdate(
    { imageUrl: job.imageUrl },
    {
      $set: {
        ...labeledImagePayload(job, userId),
        exportedAt: null,
      },
    },
    { upsert: true, new: true }
  );
}

async function backfillLabeledImages() {
  const jobs = await LabelingJob.find({
    status: 'labeled',
    'boxes.0': { $exists: true },
  });
  const ops = jobs
    .filter(isPublishableJob)
    .map((job) => ({
      updateOne: {
        filter: { imageUrl: job.imageUrl },
        update: {
          $set: labeledImagePayload(job, job.labeledBy),
          $setOnInsert: { exportedAt: null },
        },
        upsert: true,
      },
    }));
  if (!ops.length) return { upserted: 0 };
  const result = await LabeledImage.bulkWrite(ops);
  return { upserted: result.upsertedCount + result.modifiedCount };
}

async function resetJobToUnlabeled(job) {
  const keepLoadQueue = job.category === 'load';
  job.label = null;
  job.loadSize = null;
  job.boxes = [];
  job.status = 'pending';
  job.labeledAt = null;
  job.skippedAt = null;
  job.predictedAt = null;
  job.labeledBy = null;
  job.category = keepLoadQueue ? 'load' : null;
  await job.save();
  await publishLabeledImage(job, null);
  return job;
}

module.exports = {
  DEFAULT_YOLO_CLASSES,
  LOAD_SIZES,
  isLabelingImageUrl,
  ensureDefaultClasses,
  nextYoloIndex,
  predictBoxes,
  enqueueQuotationImages,
  enqueueTaskImages,
  enqueueImageJobs,
  syncJobsFromQuotations,
  syncJobsFromOrders,
  syncAllLabelingJobs,
  toYoloRow,
  yoloClassNames,
  buildDataYamlNames,
  publishLabeledImage,
  backfillLabeledImages,
  resetJobToUnlabeled,
  getYoloPredictUrl,
};
