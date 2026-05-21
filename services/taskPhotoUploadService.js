const fs = require('fs');
const path = require('path');
const cloudinary = require('../helper/cloudinaryConfig');
const { buildCloudinaryUploadOptions } = require('../helper/cloudinaryUploadParams');
const TaskPhotoUploadJob = require('../models/TaskPhotoUploadJob');
const Task = require('../models/Task');
const Driver = require('../models/Driver');
const Helper = require('../models/Helper');
const Truck = require('../models/Truck');
const AdditionalItemRequest = require('../models/AdditionalItemRequest');
const { User } = require('../models/User');
const { emitNotificationToUser, emitRefresh } = require('../socket');

const ALLOWED_PAYMENT_METHODS = [
  'cash',
  'BankTransfer',
  'payment_link',
  'partial_payment',
  'online',
];

/** Each step endpoint (initial / intermediate / final / additional) runs its own job in parallel. */
function enqueueTaskPhotoUploadJob(jobId) {
  const id = jobId.toString();
  setImmediate(() => {
    processTaskPhotoUploadJob(id).catch((err) =>
      console.error('Unhandled upload job error:', id, err),
    );
  });
}

function removePathSafe(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn('Failed to delete temp file:', filePath, err.message);
  }
}

function removeTempDirSafe(dir) {
  if (!dir) return;
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn('Failed to delete temp dir:', dir, err.message);
  }
}

function cleanupJobTempFiles(job) {
  if (job.tempFiles?.length) {
    for (const f of job.tempFiles) {
      removePathSafe(f.path);
    }
  }
  removeTempDirSafe(job.tempDir);
}

async function uploadLocalFileToCloudinary(fileMeta) {
  const options = buildCloudinaryUploadOptions(fileMeta);
  const result = await cloudinary.uploader.upload(fileMeta.path, options);
  return result.secure_url;
}

/**
 * Tell clients to refetch task details.
 * @param {object} job - TaskPhotoUploadJob doc or plain { _id, taskId, step, additionalItemRequestId? }
 * @param {'queued'|'completed'} uploadPhase - queued = with 202; completed = media saved on task/request
 */
async function emitPhotoUploadRefresh(job, uploadPhase = 'completed') {
  const task = await Task.findById(job.taskId)
    .select('_id truckId date orderNumber taskStatus')
    .lean();
  if (!task) return;

  const taskId = task._id.toString();

  emitRefresh({
    resource: 'task-details',
    action: 'refresh',
    taskId,
    truckId: task.truckId?.toString?.() ?? task.truckId ?? null,
    date: task.date ? new Date(task.date).toISOString().split('T')[0] : null,
    meta: {
      photoStep: job.step,
      jobId: job._id.toString(),
      uploadPhase,
      orderNumber: task.orderNumber,
      taskStatus: task.taskStatus,
      ...(job.step === 'additional' && job.additionalItemRequestId
        ? { additionalItemRequestId: job.additionalItemRequestId.toString() }
        : {}),
    },
  });
}

async function notifyUploadFailed(job, message) {
  const task = await Task.findById(job.taskId).select('orderNumber').lean();
  const orderLabel = task?.orderNumber ? `order ${task.orderNumber}` : 'your job';
  await emitNotificationToUser(
    job.userId.toString(),
    'Orders',
    message || `Photo upload failed for ${orderLabel}. Please retry this step.`,
    null,
    {
      type: 'task_photo_upload_failed',
      jobId: job._id.toString(),
      taskId: job.taskId.toString(),
      step: job.step,
      error: job.error || message,
    },
  );
}

async function markJobFailed(job, errorMessage) {
  job.status = 'failed';
  job.error = errorMessage;
  job.completedAt = new Date();
  await job.save();
  cleanupJobTempFiles(job);
  await notifyUploadFailed(job, errorMessage);
}

async function processTaskPhotoUploadJob(jobId) {
  const job = await TaskPhotoUploadJob.findById(jobId);
  if (!job || job.status !== 'queued') {
    return;
  }

  job.status = 'processing';
  await job.save();

  try {
    const fileMetas = (job.tempFiles || []).filter(
      (f) => f.path && fs.existsSync(f.path),
    );
    const urls = await Promise.all(fileMetas.map((f) => uploadLocalFileToCloudinary(f)));
    job.cloudinaryUrls = urls;

    if (job.step === 'initial') {
      await processInitialStep(job, urls);
    } else if (job.step === 'intermediate') {
      await processIntermediateStep(job, urls);
    } else if (job.step === 'final') {
      await processFinalStep(job, urls);
    } else if (job.step === 'additional') {
      await processAdditionalStep(job, urls);
    }

    job.status = 'completed';
    job.completedAt = new Date();
    job.error = '';
    await job.save();
    cleanupJobTempFiles(job);

    await emitPhotoUploadRefresh(job, 'completed');
  } catch (err) {
    console.error(`TaskPhotoUploadJob ${jobId} failed:`, err);
    await markJobFailed(job, err.message || 'Upload processing failed');
  }
}

async function processInitialStep(job, urls) {
  const currentTask = await Task.findById(job.taskId);
  if (!currentTask) {
    throw new Error('Current task not found.');
  }

  const updatedTask = await Task.findByIdAndUpdate(
    job.taskId,
    {
      $push: {
        initialConditionPhotos: {
          items: urls,
          description: job.description,
        },
      },
    },
    { new: true },
  );
  if (!updatedTask) {
    throw new Error('Failed to update the task with initial condition photos.');
  }

  const address = currentTask.collectionAddress || null;
  if (job.userType === 'Driver') {
    await Driver.findByIdAndUpdate(job.userId, { currentJobAddress: address }, { new: true });
  } else if (job.userType === 'Helper') {
    await Helper.findByIdAndUpdate(job.userId, { currentJobAddress: address }, { new: true });
  }
}

async function processIntermediateStep(job, urls) {
  const currentTask = await Task.findById(job.taskId);
  if (!currentTask) {
    throw new Error('Current task not found.');
  }

  await Task.findByIdAndUpdate(job.taskId, {
    intermediateConditionPhotos: [
      {
        items: urls,
        description: job.description,
      },
    ],
  });

  const address = currentTask.collectionAddress;
  if (job.userType === 'Driver') {
    await Driver.findByIdAndUpdate(job.userId, { currentJobAddress: address }, { new: true });
  } else if (job.userType === 'Helper') {
    await Helper.findByIdAndUpdate(job.userId, { currentJobAddress: address }, { new: true });
  }
}

async function processFinalStep(job, urls) {
  const task = await Task.findByIdAndUpdate(
    job.taskId,
    {
      finalConditionPhotos: [
        {
          items: urls,
          description: job.description,
        },
      ],
    },
    { new: true },
  );
  if (!task) {
    throw new Error('Task not found.');
  }
}

async function processAdditionalStep(job, urls) {
  const task = await Task.findById(job.taskId);
  if (!task) {
    throw new Error('Task not found');
  }

  const requestPayload = {
    parentTaskId: task._id,
    itemName: job.description,
    quantity: job.quantity,
    Objectsposition: 'Outside',
    quotedPrice: null,
    paymentMethod: job.paymentMethod,
    media: urls,
    status: 'pending_admin_quote',
    requestedBy: job.userId,
    requestedByType: job.userType,
  };

  const createdRequest = await AdditionalItemRequest.create(requestPayload);
  job.additionalItemRequestId = createdRequest._id;
  await job.save();

  const notificationMessage = `${job.actorName} submitted an additional item request for order ${task.orderNumber}: "${job.description}"`;
  const adminUsers = await User.find({
    $or: [{ roleType: 'Admin' }, { role: 'Admin' }],
  }).select('_id');

  await Promise.all(
    adminUsers.map((adminUser) =>
      emitNotificationToUser(adminUser._id.toString(), 'Orders', notificationMessage),
    ),
  );
}

function mapMulterFiles(files) {
  return (files || []).map((file) => ({
    path: file.path,
    mimetype: file.mimetype,
    originalname: file.originalname,
  }));
}

function cleanupMulterFiles(files) {
  const list = files || [];
  const dirs = new Set();
  for (const file of list) {
    if (file.path) {
      removePathSafe(file.path);
      if (file.destination) {
        dirs.add(file.destination);
      } else {
        dirs.add(path.dirname(file.path));
      }
    }
  }
  for (const dir of dirs) {
    removeTempDirSafe(dir);
  }
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {'initial'|'intermediate'|'final'|'additional'} step
 * @param {{ getUserModel: Function, getTruckForUser: Function }} deps
 */
async function handleTaskPhotoUploadRequest(req, res, step, deps) {
  const { taskId } = req.params;
  const userId = req.user._id;
  const files = Array.isArray(req.files) ? req.files : [];
  const description = req.body.description;
  const tempDir = req._taskPhotoTempDir || (files[0] ? path.dirname(files[0].path) : '');

  try {
    const userInfo = await deps.getUserModel(userId);
    if (!userInfo) {
      cleanupMulterFiles(files);
      return res.status(404).json({ message: 'User not found' });
    }

    const { type } = userInfo;
    let paymentMethod = '';
    let quantity = 1;
    let itemName = '';

    if (step === 'additional') {
      itemName = String(description || '').trim();
      if (!itemName) {
        cleanupMulterFiles(files);
        return res.status(400).json({ message: 'description is required' });
      }
      paymentMethod = String(req.body.paymentMethod || '').trim();
      if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) {
        cleanupMulterFiles(files);
        return res.status(400).json({
          message:
            'paymentMethod is required and must be one of: cash, BankTransfer, payment_link, partial_payment, online',
        });
      }
      const q = Number(req.body.quantity);
      quantity = Number.isFinite(q) && q > 0 ? q : 1;

      const task = await Task.findById(taskId);
      if (!task) {
        cleanupMulterFiles(files);
        return res.status(404).json({ message: 'Task not found' });
      }
    } else if (step === 'initial' || step === 'intermediate') {
      const truck = await deps.getTruckForUser(userId);
      if (!truck) {
        cleanupMulterFiles(files);
        return res.status(404).json({ message: 'No truck found for the given user.' });
      }
      const currentTask = await Task.findById(taskId);
      if (!currentTask) {
        cleanupMulterFiles(files);
        return res.status(404).json({ message: 'Current task not found.' });
      }
    } else if (step === 'final') {
      const task = await Task.findById(taskId);
      if (!task) {
        cleanupMulterFiles(files);
        return res.status(404).json({ message: 'Task not found' });
      }
    }

    const taskForActor = await Task.findById(taskId).select('firstName lastName orderNumber');
    const actorName =
      userInfo?.user?.username ||
      `${taskForActor?.firstName || ''} ${taskForActor?.lastName || ''}`.trim() ||
      type;

    const job = await TaskPhotoUploadJob.create({
      taskId,
      userId,
      step,
      status: 'queued',
      description: step === 'additional' ? itemName : description,
      paymentMethod,
      quantity,
      userType: type,
      actorName,
      tempFiles: mapMulterFiles(files),
      tempDir,
    });

    const stepMessages = {
      initial: 'Initial condition photos',
      intermediate: 'Intermediate condition photos',
      final: 'Final condition photos',
      additional: 'Additional item request',
    };

    const jobId = job._id.toString();
    const responseBody = {
      message: `${stepMessages[step]} accepted and processing in background`,
      jobId: job._id,
      taskId,
      status: 'queued',
      userType: type,
    };

    // Refresh task details as soon as upload is accepted (202)
    await emitPhotoUploadRefresh(job, 'queued');

    // Cloudinary + DB only after the client has received 202
    const startBackgroundUpload = () => enqueueTaskPhotoUploadJob(jobId);
    if (res.writableFinished) {
      setImmediate(startBackgroundUpload);
    } else {
      res.once('finish', startBackgroundUpload);
    }

    return res.status(202).json(responseBody);
  } catch (error) {
    console.error(`handleTaskPhotoUploadRequest (${step}):`, error);
    cleanupMulterFiles(files);

    if (error.message && error.message.includes('Iterator value')) {
      try {
        await Truck.cleanupTasks();
        return res.status(500).json({
          message: 'Database cleanup required. Please try again.',
          error: 'Map data corruption detected and fixed. Please retry the operation.',
        });
      } catch (cleanupError) {
        console.error('Cleanup failed:', cleanupError);
      }
    }

    return res.status(500).json({
      message: 'Failed to queue photo upload',
      error: error.message,
    });
  }
}

async function cleanupStaleUploadJobs(maxAgeMs = 2 * 60 * 60 * 1000) {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const stale = await TaskPhotoUploadJob.find({
    status: { $in: ['queued', 'processing'] },
    createdAt: { $lt: cutoff },
  });

  for (const job of stale) {
    job.status = 'failed';
    job.error = 'Upload timed out';
    job.completedAt = new Date();
    await job.save();
    cleanupJobTempFiles(job);
    await notifyUploadFailed(job, 'Photo upload timed out. Please retry this step.');
  }
}

module.exports = {
  handleTaskPhotoUploadRequest,
  processTaskPhotoUploadJob,
  enqueueTaskPhotoUploadJob,
  cleanupStaleUploadJobs,
  cleanupJobTempFiles,
  cleanupMulterFiles,
};
