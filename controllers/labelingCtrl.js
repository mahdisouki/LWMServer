const mongoose = require('mongoose');
const LabelClass = require('../models/LabelClass');
const LabelingJob = require('../models/LabelingJob');
const LabeledImage = require('../models/LabeledImage');
const labelingService = require('../services/labelingService');

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(2000, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

function serializeJob(job) {
  const plain = typeof job.toObject === 'function' ? job.toObject() : job;
  const label = plain.label || plain.loadSize || null;
  const category = plain.category
    || (labelingService.LOAD_SIZES.includes(label) ? 'load' : label ? 'item' : null);
  return {
    _id: String(plain._id),
    source: plain.source || 'quotation',
    quotationId: plain.quotationId ? String(plain.quotationId) : null,
    taskId: plain.taskId ? String(plain.taskId) : null,
    orderNumber: plain.orderNumber || '',
    imageUrl: plain.imageUrl,
    customerName: plain.customerName || '',
    email: plain.email || '',
    label,
    loadSize: plain.loadSize || null,
    category,
    status: plain.status,
    boxes: plain.boxes || [],
    predictedAt: plain.predictedAt || null,
    labeledAt: plain.labeledAt || null,
    skippedAt: plain.skippedAt || null,
    labeledBy: plain.labeledBy || null,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

function validateBoxes(boxes) {
  if (!Array.isArray(boxes)) {
    return 'boxes must be an array';
  }

  for (const box of boxes) {
    if (
      !box ||
      typeof box.label !== 'string' ||
      !box.label.trim() ||
      !Number.isFinite(Number(box.x)) ||
      !Number.isFinite(Number(box.y)) ||
      !Number.isFinite(Number(box.width)) ||
      !Number.isFinite(Number(box.height))
    ) {
      return 'Each box must include label and YOLO x, y, width, and height';
    }

    const x = Number(box.x);
    const y = Number(box.y);
    const width = Number(box.width);
    const height = Number(box.height);
    if (x < 0 || x > 1 || y < 0 || y > 1 || width <= 0 || width > 1 || height <= 0 || height > 1) {
      return 'Each box must use YOLO format: normalized center x, y and width, height between 0 and 1';
    }
  }

  return null;
}

function itemsModuleFilter() {
  // Classes queue only: not finished, not sent to Loads
  return {
    $and: [
      { $or: [{ category: { $exists: false } }, { category: null }] },
      { status: { $nin: ['labeled', 'skipped'] } },
    ],
  };
}

function loadsModuleFilter() {
  // Loads queue only: unfinished load photos
  return {
    category: 'load',
    status: { $nin: ['labeled', 'skipped'] },
  };
}

function unlabeledFilter(moduleName) {
  if (moduleName === 'loads') {
    return {
      category: 'load',
      status: { $nin: ['labeled', 'skipped'] },
      $or: [{ boxes: { $exists: false } }, { boxes: { $size: 0 } }],
    };
  }
  return itemsModuleFilter();
}

function labeledFilter(moduleName) {
  if (moduleName === 'loads') {
    return { category: 'load', status: 'labeled' };
  }
  if (moduleName === 'items') {
    return { category: 'item', status: 'labeled' };
  }
  return { status: 'labeled' };
}

function labeledImageCategoryFilter(moduleName) {
  return moduleName === 'loads' ? { category: 'load' } : { category: 'item' };
}

function serializeLabeled(doc) {
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    _id: String(plain._id),
    jobId: plain.jobId ? String(plain.jobId) : null,
    source: plain.source || 'quotation',
    quotationId: plain.quotationId ? String(plain.quotationId) : null,
    taskId: plain.taskId ? String(plain.taskId) : null,
    orderNumber: plain.orderNumber || '',
    imageUrl: plain.imageUrl,
    customerName: plain.customerName || '',
    email: plain.email || '',
    category: plain.category,
    label: plain.label,
    loadSize: plain.loadSize || null,
    boxes: plain.boxes || [],
    labeledBy: plain.labeledBy || null,
    labeledAt: plain.labeledAt,
    exportedAt: plain.exportedAt || null,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

function buildExportItems(records, classes) {
  const names = labelingService.yoloClassNames(classes);
  return records.map((record) => {
    const boxes = (record.boxes || []).map((box) => ({
      label: box.label,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      source: box.source || 'human',
    }));
    return {
      imageUrl: record.imageUrl,
      label: record.label,
      category: record.category,
      boxes,
      yolo: boxes
        .map((box) => {
          const classIndex = names.indexOf(box.label);
          if (classIndex < 0) return null;
          return labelingService.toYoloRow(box, classIndex);
        })
        .filter(Boolean),
      source: record.source,
      quotationId: record.quotationId ? String(record.quotationId) : null,
      taskId: record.taskId ? String(record.taskId) : null,
      orderNumber: record.orderNumber || '',
    };
  });
}

const labelingCtrl = {
  getJobs: async (req, res) => {
    try {
      await labelingService.ensureDefaultClasses();
      const { page, limit, skip } = parsePagination(req.query);
      const status = String(req.query.status || 'all');
      const source = String(req.query.source || 'all');
      const keyword = String(req.query.keyword || '').trim();
      const moduleName = req.query.module === 'loads' ? 'loads' : 'items';
      const moduleFilter = moduleName === 'loads'
        ? loadsModuleFilter()
        : itemsModuleFilter();

      const filter = {};
      if (status === 'unlabeled') {
        Object.assign(filter, unlabeledFilter(moduleName));
      } else if (status === 'labeled') {
        Object.assign(filter, labeledFilter(moduleName));
      } else {
        Object.assign(filter, moduleFilter);
        if (['pending', 'predicted', 'labeled', 'skipped'].includes(status)) {
          filter.status = status;
        }
      }

      if (source === 'quotation' || source === 'order') {
        filter.source = source;
      }

      const label = String(req.query.label || '').trim();
      if (label) {
        filter.label = label;
      }

      const keywordFilter = keyword
        ? [
            { customerName: { $regex: keyword, $options: 'i' } },
            { email: { $regex: keyword, $options: 'i' } },
            { orderNumber: { $regex: keyword, $options: 'i' } },
          ]
        : null;

      if (keywordFilter) {
        const next = { $and: [] };
        if (Object.keys(filter).length) next.$and.push({ ...filter });
        next.$and.push({ $or: keywordFilter });
        Object.keys(filter).forEach((key) => delete filter[key]);
        Object.assign(filter, next);
      }

      const labeledImageFilter = labeledImageCategoryFilter(moduleName);
      const [jobs, total, statusCounts, classCounts, labeledCount, queueCount, unexportedCount] =
        await Promise.all([
          LabelingJob.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
          LabelingJob.countDocuments(filter),
          LabelingJob.aggregate([
            { $match: moduleFilter },
            { $group: { _id: '$status', count: { $sum: 1 } } },
          ]),
          LabeledImage.aggregate([
            { $match: labeledImageFilter },
            { $unwind: { path: '$boxes', preserveNullAndEmptyArrays: false } },
            { $group: { _id: '$boxes.label', count: { $sum: 1 } } },
          ]),
          LabeledImage.countDocuments(labeledImageFilter),
          LabelingJob.countDocuments(moduleFilter),
          LabeledImage.countDocuments({
            $or: [{ exportedAt: null }, { exportedAt: { $exists: false } }],
          }),
        ]);

      const stats = {
        pending: 0,
        predicted: 0,
        labeled: 0,
        skipped: 0,
        total: 0,
        unexported: 0,
        classes: {},
      };
      for (const row of statusCounts) {
        if (row._id in stats) {
          stats[row._id] = row.count;
        }
      }
      stats.labeled = labeledCount;
      stats.unlabeled = queueCount;
      stats.total = labeledCount + queueCount;
      for (const row of classCounts) {
        stats.classes[row._id] = row.count;
      }
      stats.unexported = unexportedCount;

      return res.status(200).json({
        message: 'Labeling jobs fetched',
        jobs: jobs.map(serializeJob),
        stats,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 0,
        },
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to fetch labeling jobs',
        error: error.message,
      });
    }
  },

  getJobById: async (req, res) => {
    try {
      const job = await LabelingJob.findById(req.params.id);
      if (!job) {
        return res.status(404).json({ message: 'Labeling job not found' });
      }
      return res.status(200).json({
        message: 'Labeling job fetched',
        job: serializeJob(job),
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to fetch labeling job',
        error: error.message,
      });
    }
  },

  getNextJob: async (req, res) => {
    try {
      const moduleName = req.query.module === 'loads' ? 'loads' : 'items';
      const excludeId = req.query.excludeId;
      const filter = { ...unlabeledFilter(moduleName) };
      if (excludeId && mongoose.Types.ObjectId.isValid(excludeId)) {
        filter._id = { $ne: excludeId };
      }

      const job = await LabelingJob.findOne(filter).sort({ createdAt: 1 });
      if (!job) {
        return res.status(404).json({ message: 'No unlabeled jobs left' });
      }

      return res.status(200).json({
        message: 'Next labeling job fetched',
        job: serializeJob(job),
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to fetch next labeling job',
        error: error.message,
      });
    }
  },

  syncFromQuotations: async (req, res) => {
    try {
      await labelingService.ensureDefaultClasses();
      const result = await labelingService.syncAllLabelingJobs();
      return res.status(200).json({
        message: 'Quote and order photos synced into the labeling queue',
        ...result,
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to sync photos',
        error: error.message,
      });
    }
  },

  predictJob: async (req, res) => {
    try {
      const job = await LabelingJob.findById(req.params.id);
      if (!job) {
        return res.status(404).json({ message: 'Labeling job not found' });
      }

      const boxes = await labelingService.predictBoxes(job.imageUrl);
      job.boxes = boxes;
      job.status = 'predicted';
      job.predictedAt = new Date();
      await job.save();

      return res.status(200).json({
        message: 'YOLO predictions applied',
        job: serializeJob(job),
      });
    } catch (error) {
      return res.status(502).json({
        message: 'YOLO prediction failed',
        error: error.message,
      });
    }
  },

  saveJob: async (req, res) => {
    try {
      const job = await LabelingJob.findById(req.params.id);
      if (!job) {
        return res.status(404).json({ message: 'Labeling job not found' });
      }

      const hasLabelField =
        Object.prototype.hasOwnProperty.call(req.body || {}, 'label')
        || Object.prototype.hasOwnProperty.call(req.body || {}, 'loadSize');
      const hasBoxesField = Object.prototype.hasOwnProperty.call(
        req.body || {},
        'boxes',
      );
      const hasCategoryField = Object.prototype.hasOwnProperty.call(
        req.body || {},
        'category',
      );

      if (!hasLabelField && !hasBoxesField && !hasCategoryField) {
        return res.status(400).json({
          message: 'Provide a class label, category, and/or bounding boxes',
        });
      }

      if (hasCategoryField) {
        if (req.body.category === 'load') {
          job.category = 'load';
        } else if (req.body.category === 'item') {
          job.category = 'item';
        } else {
          job.category = null;
        }
      }

      if (hasLabelField) {
        const rawLabel = Object.prototype.hasOwnProperty.call(req.body, 'label')
          ? req.body.label
          : req.body.loadSize;
        const name = rawLabel == null ? '' : String(rawLabel).trim();

        if (!name) {
          job.label = null;
          job.loadSize = null;
        } else {
          const existing = await LabelClass.findOne({
            name: {
              $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
              $options: 'i',
            },
          });
          if (!existing) {
            return res.status(400).json({
              message: `Unknown class "${name}". Add it first.`,
            });
          }

          job.label = existing.name;
          job.loadSize = existing.category === 'load'
            || labelingService.LOAD_SIZES.includes(existing.name)
            ? existing.name
            : null;
          job.category = existing.category === 'load' ? 'load' : 'item';
        }
      }

      if (hasBoxesField) {
        const boxesError = validateBoxes(req.body.boxes);
        if (boxesError) {
          return res.status(400).json({ message: boxesError });
        }

        job.boxes = req.body.boxes.map((box) => ({
          x: Number(box.x),
          y: Number(box.y),
          width: Number(box.width),
          height: Number(box.height),
          label: String(box.label).trim(),
          score: typeof box.score === 'number' ? box.score : undefined,
          source: box.source === 'yolo' ? 'yolo' : 'human',
        }));
      }

      const queuedLoad = job.category === 'load'
        && !labelingService.LOAD_SIZES.includes(job.label);

      if (queuedLoad && (!job.boxes || job.boxes.length === 0)) {
        job.boxes = [];
        job.status = 'pending';
        job.labeledAt = null;
      } else if (job.boxes.length > 0) {
        if (!job.label) {
          job.label = job.boxes[0].label;
          job.loadSize = labelingService.LOAD_SIZES.includes(job.label)
            ? job.label
            : null;
          job.category = labelingService.LOAD_SIZES.includes(job.label)
            ? 'load'
            : 'item';
        }
        job.status = 'labeled';
        job.labeledAt = new Date();
        job.labeledBy = req.user._id;
        job.skippedAt = null;
      } else {
        job.status = 'pending';
        job.labeledAt = null;
      }

      await job.save();
      await labelingService.publishLabeledImage(job, req.user._id);

      return res.status(200).json({
        message: 'Annotation saved',
        job: serializeJob(job),
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to save annotation',
        error: error.message,
      });
    }
  },

  skipJob: async (req, res) => {
    try {
      const job = await LabelingJob.findById(req.params.id);
      if (!job) {
        return res.status(404).json({ message: 'Labeling job not found' });
      }

      job.status = 'skipped';
      job.skippedAt = new Date();
      job.labeledBy = req.user._id;
      await job.save();

      return res.status(200).json({
        message: 'Job skipped',
        job: serializeJob(job),
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to skip labeling job',
        error: error.message,
      });
    }
  },

  unlabelJob: async (req, res) => {
    try {
      const job = await LabelingJob.findById(req.params.id);
      if (!job) {
        return res.status(404).json({ message: 'Labeling job not found' });
      }

      await labelingService.resetJobToUnlabeled(job);

      return res.status(200).json({
        message: 'Photo unlabeled',
        job: serializeJob(job),
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to unlabel photo',
        error: error.message,
      });
    }
  },

  getClasses: async (req, res) => {
    try {
      await labelingService.ensureDefaultClasses();
      const classes = await LabelClass.find().sort({ category: 1, name: 1 });
      const items = classes.filter((item) => item.category !== 'load');
      const loads = classes.filter((item) => item.category === 'load');
      return res.status(200).json({
        message: 'Label classes fetched',
        classes,
        categories: [
          { id: 'item', label: 'Items', classes: items },
          { id: 'load', label: 'Loads', classes: loads },
        ],
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to fetch label classes',
        error: error.message,
      });
    }
  },

  createClass: async (req, res) => {
    try {
      await labelingService.ensureDefaultClasses();
      const name = String(req.body?.name || '').trim();
      if (!name) {
        return res.status(400).json({ message: 'Class name is required' });
      }
      const category = req.body?.category === 'load' ? 'load' : 'item';

      const existing = await LabelClass.findOne({
        name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      });
      if (existing) {
        return res.status(409).json({
          message: 'A class with this name already exists',
          class: existing,
        });
      }

      const created = await LabelClass.create({
        name,
        isYoloClass: true,
        category,
        // Append-only index so expand/retrain never reshuffles older classes.
        yoloIndex: await labelingService.nextYoloIndex(),
      });
      return res.status(201).json({
        message: 'Class created',
        class: created,
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to create class',
        error: error.message,
      });
    }
  },

  exportDataset: async (req, res) => {
    try {
      await labelingService.ensureDefaultClasses();
      await labelingService.backfillLabeledImages();

      // mode=new (default): only never-exported. mode=all: new + already exported.
      // Legacy: ?all=true maps to mode=all.
      const mode =
        String(req.query.mode || '').toLowerCase() === 'all'
        || String(req.query.all || '') === 'true'
          ? 'all'
          : 'new';

      const rawIds = String(req.query.ids || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      const ids = rawIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
      if (rawIds.length && !ids.length) {
        return res.status(400).json({ message: 'No valid image ids provided' });
      }

      const filter = {};
      if (ids.length) {
        filter._id = { $in: ids };
      }
      if (mode === 'new') {
        filter.$or = [{ exportedAt: null }, { exportedAt: { $exists: false } }];
      }

      const classes = await LabelClass.find().sort({ category: 1, name: 1 });
      const records = await LabeledImage.find(filter).sort({ labeledAt: 1 });
      const items = buildExportItems(records, classes);

      if (records.length) {
        const now = new Date();
        await LabeledImage.updateMany(
          { _id: { $in: records.map((record) => record._id) } },
          { $set: { exportedAt: now } },
        );
      }

      const names = labelingService.yoloClassNames(classes);
      return res.status(200).json({
        message: records.length
          ? 'Dataset exported'
          : mode === 'all'
            ? 'No labeled images to export'
            : 'No new labeled images to export',
        // Copy `names` / `dataYaml` into item-detection yaml before retrain.
        // Index in `names` = YOLO class id. Never reorder existing entries.
        nc: names.length,
        names,
        dataYaml: labelingService.buildDataYamlNames(names),
        classes: {
          item: classes.filter((item) => item.category !== 'load').map((item) => item.name),
          load: classes.filter((item) => item.category === 'load').map((item) => item.name),
        },
        mode,
        count: items.length,
        items,
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to export dataset',
        error: error.message,
      });
    }
  },

  getLabeledImages: async (req, res) => {
    try {
      await labelingService.ensureDefaultClasses();
      await labelingService.backfillLabeledImages();
      const { page, limit, skip } = parsePagination(req.query);
      const category = String(req.query.category || 'all');
      const keyword = String(req.query.keyword || '').trim();
      const filter = {};
      if (category === 'item' || category === 'load') {
        filter.category = category;
      }
      if (keyword) {
        filter.$or = [
          { customerName: { $regex: keyword, $options: 'i' } },
          { email: { $regex: keyword, $options: 'i' } },
          { orderNumber: { $regex: keyword, $options: 'i' } },
          { label: { $regex: keyword, $options: 'i' } },
        ];
      }

      const [records, total, categoryCounts, unexportedCount] = await Promise.all([
        LabeledImage.find(filter).sort({ labeledAt: -1 }).skip(skip).limit(limit),
        LabeledImage.countDocuments(filter),
        LabeledImage.aggregate([
          { $group: { _id: '$category', count: { $sum: 1 } } },
        ]),
        LabeledImage.countDocuments({
          $or: [{ exportedAt: null }, { exportedAt: { $exists: false } }],
        }),
      ]);

      const stats = { item: 0, load: 0, total: 0, unexported: 0 };
      for (const row of categoryCounts) {
        if (row._id === 'item' || row._id === 'load') {
          stats[row._id] = row.count;
        }
        stats.total += row.count;
      }
      stats.unexported = unexportedCount;

      return res.status(200).json({
        message: 'Labeled images fetched',
        images: records.map(serializeLabeled),
        stats,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 0,
        },
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to fetch labeled images',
        error: error.message,
      });
    }
  },

  updateLabeledImage: async (req, res) => {
    try {
      const record = await LabeledImage.findById(req.params.id);
      if (!record) {
        return res.status(404).json({ message: 'Labeled image not found' });
      }

      const boxesError = validateBoxes(req.body?.boxes);
      if (boxesError) {
        return res.status(400).json({ message: boxesError });
      }
      if (!req.body.boxes.length) {
        return res.status(400).json({ message: 'At least one bounding box is required' });
      }

      const name = String(req.body?.label || req.body.boxes[0].label || '').trim();
      if (!name) {
        return res.status(400).json({ message: 'Class label is required' });
      }

      const existing = await LabelClass.findOne({
        name: {
          $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
          $options: 'i',
        },
      });
      if (!existing) {
        return res.status(400).json({
          message: `Unknown class "${name}". Add it first.`,
        });
      }

      record.label = existing.name;
      record.category = existing.category === 'load' ? 'load' : 'item';
      record.loadSize = labelingService.LOAD_SIZES.includes(existing.name)
        ? existing.name
        : null;
      record.boxes = req.body.boxes.map((box) => ({
        x: Number(box.x),
        y: Number(box.y),
        width: Number(box.width),
        height: Number(box.height),
        label: String(box.label).trim(),
        score: typeof box.score === 'number' ? box.score : undefined,
        source: box.source === 'yolo' ? 'yolo' : 'human',
      }));
      record.labeledAt = new Date();
      record.labeledBy = req.user._id;
      record.exportedAt = null;
      await record.save();

      if (record.jobId) {
        const job = await LabelingJob.findById(record.jobId);
        if (job) {
          job.label = record.label;
          job.category = record.category;
          job.loadSize = record.loadSize;
          job.boxes = record.boxes;
          job.status = 'labeled';
          job.labeledAt = record.labeledAt;
          job.labeledBy = req.user._id;
          await job.save();
        }
      }

      return res.status(200).json({
        message: 'Labeled image updated',
        image: serializeLabeled(record),
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to update labeled image',
        error: error.message,
      });
    }
  },

  unlabelLabeledImage: async (req, res) => {
    try {
      const record = await LabeledImage.findById(req.params.id);
      if (!record) {
        return res.status(404).json({ message: 'Labeled image not found' });
      }
      if (!record.jobId) {
        return res.status(400).json({
          message: 'Cannot unlabel: this image has no labeling job',
        });
      }

      const job = await LabelingJob.findById(record.jobId);
      if (!job) {
        return res.status(404).json({ message: 'Labeling job not found' });
      }

      await labelingService.resetJobToUnlabeled(job);

      return res.status(200).json({
        message: 'Image unlabeled',
        job: serializeJob(job),
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to unlabel image',
        error: error.message,
      });
    }
  },
};

module.exports = labelingCtrl;
