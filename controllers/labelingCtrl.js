const mongoose = require('mongoose');
const LabelClass = require('../models/LabelClass');
const LabelingJob = require('../models/LabelingJob');
const LabeledImage = require('../models/LabeledImage');
const StandardItem = require('../models/StandardItem');
const labelingService = require('../services/labelingService');

function denyUnlessSuperAdmin(req, res) {
  if (req.user?.isSuperAdmin === true) return false;
  res.status(403).json({
    message: 'Only a super admin has access to the delete button',
  });
  return true;
}

async function removeLabelingJob(job, userId) {
  job.label = null;
  job.loadSize = null;
  job.boxes = [];
  job.status = 'deleted';
  job.deletedAt = new Date();
  job.labeledAt = null;
  job.skippedAt = null;
  job.labeledBy = userId || null;
  await job.save();
  await labelingService.publishLabeledImage(job, null);
  return job;
}

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(2000, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

function visibleLabel(label) {
  if (labelingService.isHiddenYoloClass(label)) return null;
  return label || null;
}

function visibleBoxes(boxes) {
  return (Array.isArray(boxes) ? boxes : [])
    .filter((box) => !labelingService.isHiddenYoloClass(box?.label))
    .map((box) => {
      const label = labelingService.canonicalClassName(box?.label);
      if (!box || label === box.label) return box;
      const plain = typeof box.toObject === 'function' ? box.toObject() : { ...box };
      return { ...plain, label };
    });
}

function hideOwnLoadLabels(filter, userId) {
  if (!userId) return filter;
  return {
    $and: [
      filter,
      { loadLabels: { $not: { $elemMatch: { userId } } } },
    ],
  };
}

async function loadLabelerIds(currentUserId) {
  const Admin = require('../models/Admin');
  const admins = await Admin.find({
    isStillWorking: { $ne: false },
    'permissions.Labeling': 'Edit',
  }).select('_id').lean();
  const ids = admins.map((admin) => String(admin._id));
  const current = String(currentUserId);
  if (!ids.includes(current)) ids.push(current);
  return ids;
}

function majorityNeeded(labelerCount) {
  return Math.ceil(Math.max(1, labelerCount) * 0.75);
}

async function recordLoadMajority(req, res, job) {
  const userId = req.user._id;
  const { itemBoxes, loadBoxes } = labelingService.splitAnnotationBoxes(job.boxes);
  if (!loadBoxes.length) {
    return res.status(400).json({
      message: 'Pick a load size. Draw a region, or leave it to use the whole photo.',
    });
  }
  const entry = {
    userId,
    loadSize: job.label,
    boxes: loadBoxes,
    labeledAt: new Date(),
  };
  const openFilter = {
    _id: job._id,
    status: { $nin: ['deleted', 'labeled'] },
  };
  const waitingCategory = itemBoxes.length ? 'mixed' : 'load';

  const pulled = await LabelingJob.updateOne(openFilter, {
    $pull: { loadLabels: { userId } },
  });
  if (!pulled.matchedCount) {
    return res.status(409).json({
      message: 'This photo was just labeled by someone else',
    });
  }

  const saved = await LabelingJob.findOneAndUpdate(
    openFilter,
    {
      $push: { loadLabels: entry },
      $set: {
        label: null,
        loadSize: null,
        boxes: itemBoxes,
        category: waitingCategory,
        status: 'pending',
        labeledAt: null,
        skippedAt: null,
      },
    },
    { new: true },
  );
  if (!saved) {
    return res.status(409).json({
      message: 'This photo was just labeled by someone else',
    });
  }

  const labelerIds = await loadLabelerIds(userId);
  const allowed = new Set(labelerIds);
  const counts = {};
  for (const vote of saved.loadLabels || []) {
    if (!allowed.has(String(vote.userId))) continue;
    counts[vote.loadSize] = (counts[vote.loadSize] || 0) + 1;
  }
  const needed = majorityNeeded(labelerIds.length);
  const winner = Object.keys(counts).find((size) => counts[size] >= needed) || null;

  if (!winner) {
    emitLabelingJobsChanged(saved, userId);
    return res.status(200).json({
      message: 'Load size recorded. Waiting for the other labelers.',
      awaitingMajority: true,
      job: serializeJob(saved),
    });
  }

  const winningVote = [...saved.loadLabels].reverse().find(
    (vote) => vote.loadSize === winner && allowed.has(String(vote.userId)),
  );
  const winningBoxes = labelingService.splitAnnotationBoxes(winningVote?.boxes || loadBoxes).loadBoxes;
  const finalBoxes = [...itemBoxes, ...winningBoxes];
  const category = itemBoxes.length ? 'mixed' : 'load';
  const finalized = await LabelingJob.findOneAndUpdate(
    openFilter,
    {
      $set: {
        label: category === 'mixed' ? itemBoxes[0].label : winner,
        loadSize: winner,
        boxes: finalBoxes,
        category,
        status: 'labeled',
        labeledAt: new Date(),
        labeledBy: winningVote?.userId || userId,
        skippedAt: null,
      },
    },
    { new: true },
  );
  const done = finalized || await LabelingJob.findById(job._id);
  if (finalized) {
    await labelingService.publishLabeledImage(finalized, userId);
  }
  emitLabelingJobsChanged(done, userId);
  return res.status(200).json({
    message: 'Annotation saved',
    awaitingMajority: false,
    job: serializeJob(done),
  });
}

function emitLabelingJobsChanged(jobs, actorId) {
  try {
    const { getIo } = require('../socket');
    const io = getIo();
    const list = (Array.isArray(jobs) ? jobs : [jobs]).filter(Boolean).map((job) => ({
      jobId: String(job._id),
      status: job.status,
      category: job.category || null,
      label: job.label || job.loadSize || null,
      actorId: actorId ? String(actorId) : null,
    }));
    if (!list.length) return;
    io.emit('labeling:jobs-changed', { jobs: list });
  } catch (error) {
    // Socket is not available when the API is imported outside the running server.
  }
}

function serializeJob(job) {
  const plain = typeof job.toObject === 'function' ? job.toObject() : job;
  const storedLabel = labelingService.canonicalClassName(plain.label || plain.loadSize || '');
  const label = visibleLabel(storedLabel);
  const category = plain.category
    || (labelingService.LOAD_SIZES.includes(storedLabel) ? 'load' : label ? 'item' : null);
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
    loadSize: plain.loadSize ? labelingService.canonicalClassName(plain.loadSize) : null,
    category,
    status: plain.status,
    boxes: visibleBoxes(plain.boxes),
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
  // Classes queue: not finished and not sitting in Loads.
  // category "item" here is only an unfinished revert; a labeled class photo
  // has status "labeled" and is excluded below.
  return {
    $and: [
      {
        $or: [
          { category: { $exists: false } },
          { category: null },
          { category: 'item' },
        ],
      },
      { status: { $nin: ['labeled', 'skipped', 'deleted'] } },
    ],
  };
}

function loadsModuleFilter() {
  // Unfinished load-only photos, and photos that already have item boxes and still need a size.
  return {
    category: { $in: ['load', 'mixed'] },
    status: { $nin: ['labeled', 'skipped', 'deleted'] },
  };
}

function unlabeledFilter(moduleName) {
  if (moduleName === 'loads') return loadsModuleFilter();
  return itemsModuleFilter();
}

function labeledFilter(moduleName) {
  if (moduleName === 'loads') {
    return { category: { $in: ['load', 'mixed'] }, status: 'labeled' };
  }
  if (moduleName === 'items') {
    return { category: 'item', status: 'labeled' };
  }
  return { status: 'labeled' };
}

function labeledImageCategoryFilter(moduleName) {
  if (moduleName === 'loads') return { category: { $in: ['load', 'mixed'] } };
  return { category: 'item' };
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
    label: visibleLabel(labelingService.canonicalClassName(plain.label)),
    loadSize: plain.loadSize ? labelingService.canonicalClassName(plain.loadSize) : null,
    boxes: visibleBoxes(plain.boxes),
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

      const visibleFilter = moduleName === 'loads' && status !== 'labeled'
        ? hideOwnLoadLabels(filter, req.user?._id)
        : filter;
      const visibleModuleFilter = moduleName === 'loads'
        ? hideOwnLoadLabels(moduleFilter, req.user?._id)
        : moduleFilter;

      const labeledImageFilter = labeledImageCategoryFilter(moduleName);
      const [jobs, total, statusCounts, classCounts, labeledCount, queueCount, unexportedCount] =
        await Promise.all([
          LabelingJob.find(visibleFilter).sort({ createdAt: -1 }).skip(skip).limit(limit),
          LabelingJob.countDocuments(visibleFilter),
          LabelingJob.aggregate([
            { $match: visibleModuleFilter },
            { $group: { _id: '$status', count: { $sum: 1 } } },
          ]),
          LabeledImage.aggregate([
            { $match: labeledImageFilter },
            { $unwind: { path: '$boxes', preserveNullAndEmptyArrays: false } },
            { $group: { _id: '$boxes.label', count: { $sum: 1 } } },
          ]),
          LabeledImage.countDocuments(labeledImageFilter),
          LabelingJob.countDocuments(visibleModuleFilter),
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
        if (labelingService.isHiddenYoloClass(row._id)) continue;
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
      const filter = moduleName === 'loads'
        ? hideOwnLoadLabels({ ...unlabeledFilter(moduleName) }, req.user?._id)
        : { ...unlabeledFilter(moduleName) };
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
      await labelingService.renameLegacyFullLoadClass();
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
        } else if (req.body.category === 'mixed') {
          job.category = 'mixed';
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
        const name = rawLabel == null ? '' : labelingService.canonicalClassName(rawLabel);

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

      const requestedCategory = hasCategoryField ? req.body.category : undefined;
      const split = labelingService.splitAnnotationBoxes(job.boxes);
      const loadName = labelingService.LOAD_SIZES.includes(job.label) ? job.label : null;
      const sameOwnerEdit = job.status === 'labeled'
        && String(job.labeledBy) === String(req.user._id);

      const queuePending = (nextCategory, nextBoxes) => {
        job.boxes = nextBoxes;
        job.label = null;
        job.loadSize = null;
        job.category = nextCategory;
        job.status = 'pending';
        job.labeledAt = null;
        job.labeledBy = null;
        job.skippedAt = null;
      };

      // Back to Classes. Item boxes stay; the load vote is cleared with the save.
      if (hasCategoryField && (requestedCategory == null || requestedCategory === '')) {
        queuePending(null, split.itemBoxes);
      } else if (job.category === 'mixed' && !loadName) {
        if (!split.itemBoxes.length) {
          return res.status(400).json({
            message: 'Draw at least one item before adding a load',
          });
        }
        queuePending('mixed', split.itemBoxes);
      } else if (job.category === 'load' && !loadName) {
        queuePending('load', []);
      } else if (loadName && split.loadBoxes.length && !sameOwnerEdit) {
        job.category = split.itemBoxes.length ? 'mixed' : 'load';
        job.label = loadName;
        job.loadSize = loadName;
        job.boxes = [...split.itemBoxes, ...split.loadBoxes];
        return recordLoadMajority(req, res, job);
      } else if (loadName && split.loadBoxes.length) {
        job.category = split.itemBoxes.length ? 'mixed' : 'load';
        job.label = split.itemBoxes.length ? split.itemBoxes[0].label : loadName;
        job.loadSize = loadName;
        job.boxes = [...split.itemBoxes, ...split.loadBoxes];
        job.status = 'labeled';
        job.labeledAt = new Date();
        job.labeledBy = req.user._id;
        job.skippedAt = null;
      } else if (split.itemBoxes.length) {
        job.boxes = split.itemBoxes;
        job.category = 'item';
        job.loadSize = null;
        if (!job.label || labelingService.LOAD_SIZES.includes(job.label)) {
          job.label = split.itemBoxes[0].label;
        }
        job.status = 'labeled';
        job.labeledAt = new Date();
        job.labeledBy = req.user._id;
        job.skippedAt = null;
      } else {
        job.boxes = [];
        job.status = 'pending';
        job.labeledAt = null;
        if (job.category === 'item' || job.category === 'mixed') {
          job.category = null;
        }
      }

      const saved = await LabelingJob.findOneAndUpdate(
        {
          _id: job._id,
          status: { $ne: 'deleted' },
          $or: [
            { status: { $ne: 'labeled' } },
            { labeledBy: req.user._id },
          ],
        },
        {
          $set: {
            label: job.label,
            loadSize: job.loadSize,
            category: job.category,
            boxes: job.boxes,
            status: job.status,
            labeledAt: job.labeledAt,
            labeledBy: job.labeledBy,
            skippedAt: job.skippedAt,
            predictedAt: job.predictedAt,
            loadLabels: [],
          },
        },
        { new: true },
      );
      if (!saved) {
        return res.status(409).json({
          message: 'This photo was just labeled by someone else',
        });
      }
      await labelingService.publishLabeledImage(saved, req.user._id);
      emitLabelingJobsChanged(saved, req.user._id);

      return res.status(200).json({
        message: 'Annotation saved',
        job: serializeJob(saved),
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
      emitLabelingJobsChanged(job, req.user._id);

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

  deleteJob: async (req, res) => {
    try {
      if (denyUnlessSuperAdmin(req, res)) return;
      const job = await LabelingJob.findById(req.params.id);
      if (!job) {
        return res.status(404).json({ message: 'Labeling job not found' });
      }

      await removeLabelingJob(job, req.user._id);
      emitLabelingJobsChanged(job, req.user._id);

      return res.status(200).json({
        message: 'Photo deleted',
        job: serializeJob(job),
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to delete photo',
        error: error.message,
      });
    }
  },

  deleteJobs: async (req, res) => {
    try {
      if (denyUnlessSuperAdmin(req, res)) return;
      const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
        .map((id) => String(id))
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
      if (!ids.length) {
        return res.status(400).json({ message: 'Select at least one photo' });
      }

      const jobs = await LabelingJob.find({ _id: { $in: ids } });
      await Promise.all(jobs.map((job) => removeLabelingJob(job, req.user._id)));
      emitLabelingJobsChanged(jobs, req.user._id);

      return res.status(200).json({
        message: 'Photos deleted',
        deleted: jobs.length,
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Failed to delete photos',
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
      emitLabelingJobsChanged(job, req.user._id);

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
      const classes = (await LabelClass.find().sort({ category: 1, name: 1 }))
        .filter((item) => !labelingService.isHiddenYoloClass(item.name));
      const items = classes.filter((item) => item.category !== 'load');
      const loads = classes.filter((item) => item.category === 'load');
      const catalogueNames = await labelingService.listCatalogueNamesMissingFromYaml(classes);
      return res.status(200).json({
        message: 'Label classes fetched',
        classes,
        catalogueNames,
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
      const requested = String(req.body?.name || '').trim();
      if (!requested) {
        return res.status(400).json({ message: 'Class name is required' });
      }

      const escaped = requested.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const catalogueItem = await StandardItem.findOne({
        isHidden: { $ne: true },
        itemName: { $regex: `^${escaped}$`, $options: 'i' },
      })
        .select('itemName')
        .lean();
      const name = String(catalogueItem?.itemName || '').trim();
      if (!name) {
        return res.status(400).json({
          message: 'Class names must match a standard item. Pick one from Standard items.',
        });
      }
      const coveredBy = labelingService.yamlNameForCatalogueItem(name);
      if (coveredBy) {
        const yamlClass = await LabelClass.findOne({ name: coveredBy });
        return res.status(409).json({
          message: `Already covered by the class "${coveredBy}"`,
          class: yamlClass,
        });
      }

      const category = labelingService.LOAD_SIZES.includes(name) ? 'load' : 'item';
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
      if (category === 'item' || category === 'load' || category === 'mixed') {
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

      const normalizedBoxes = [];
      for (const box of req.body.boxes) {
        const name = labelingService.canonicalClassName(String(box.label || '').trim());
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
        normalizedBoxes.push({
          x: Number(box.x),
          y: Number(box.y),
          width: Number(box.width),
          height: Number(box.height),
          label: existing.name,
          score: typeof box.score === 'number' ? box.score : undefined,
          source: box.source === 'yolo' ? 'yolo' : 'human',
        });
      }

      const { itemBoxes, loadBoxes } = labelingService.splitAnnotationBoxes(normalizedBoxes);
      if (itemBoxes.length && loadBoxes.length) {
        record.category = 'mixed';
        record.label = itemBoxes[0].label;
        record.loadSize = loadBoxes[0].label;
      } else if (loadBoxes.length) {
        record.category = 'load';
        record.label = loadBoxes[0].label;
        record.loadSize = loadBoxes[0].label;
      } else if (itemBoxes.length) {
        record.category = 'item';
        record.label = itemBoxes[0].label;
        record.loadSize = null;
      } else {
        return res.status(400).json({ message: 'Class label is required' });
      }
      record.boxes = [...itemBoxes, ...loadBoxes];
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
          emitLabelingJobsChanged(job, req.user._id);
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
      emitLabelingJobsChanged(job, req.user._id);

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
