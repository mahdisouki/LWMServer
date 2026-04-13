const Incident = require('../models/Incident');
const Notification = require('../models/Notification');
const Truck = require('../models/Truck');
const { User } = require('../models/User');

// Static breakdown procedure definition – mirrors your paper checklist
const BREAKDOWN_TEMPLATE = [
    {
        order: 0,
        title: 'Call Radius with breakdown details',
        required: true,
    },
    {
        order: 1,
        title: 'Arrange taxi for team after recovery',
        required: true,
    },
    {
        order: 2,
        title: 'Request a replacement van from Radius',
        required: true,
    },
    {
        order: 3,
        title: 'Send replacement van details to Motum Insurance',
        required: true,
    },
    {
        order: 4,
        title: 'Share insurance confirmation with Radius',
        required: true,
    },
    {
        order: 5,
        title: 'Add new van to congestion and Dart accounts',
        required: true,
    },
    {
        order: 6,
        title: 'Confirm completion with Adam',
        required: true,
    },
    {
        order: 7,
        title: 'Arrange cover plan with affected teams',
        required: true,
    },
    {
        order: 8,
        title: 'Update van management records',
        required: true,
    },
];

// Helper to instantiate steps for a new incident
function buildStepsFromTemplate(template) {
    return template
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((step) => ({
            title: step.title,
            order: step.order,
            required: step.required !== false,
            status: 'PENDING',
        }));
}

// Shared helper to optionally auto-complete the first step
function maybeCompleteFirstStep(steps, notes, photos, userId) {
    if (!steps || steps.length === 0) return;

    if (notes || (Array.isArray(photos) && photos.length > 0)) {
        const firstStep = steps.find((s) => s.order === 0);
        if (firstStep) {
            firstStep.status = 'DONE';
            firstStep.completedAt = new Date();
            if (userId) {
                firstStep.completedBy = userId;
            }
        }
    }
}

function parseBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    return undefined;
}

function mapFilesToPhotos(files = []) {
    return files
        .filter((file) => !!file.path)
        .map((file) => ({
            url: file.path,
        }));
}

function getUploadedPhotos(reqFiles, fieldName) {
    if (!reqFiles) return [];

    if (Array.isArray(reqFiles)) {
        if (fieldName !== 'photos') return [];
        return mapFilesToPhotos(reqFiles);
    }

    const filesForField = Array.isArray(reqFiles[fieldName]) ? reqFiles[fieldName] : [];
    return mapFilesToPhotos(filesForField);
}

function normalizeMediaInput(rawValue) {
    if (typeof rawValue === 'undefined') return undefined;

    let parsed = rawValue;

    if (typeof rawValue === 'string') {
        try {
            parsed = JSON.parse(rawValue);
        } catch {
            parsed = rawValue ? [rawValue] : [];
        }
    }

    if (Array.isArray(parsed)) {
        return parsed
            .filter(Boolean)
            .map((item) =>
                typeof item === 'string' ? { url: item } : item && item.url ? { url: item.url } : null
            )
            .filter(Boolean);
    }

    if (parsed && typeof parsed === 'object' && parsed.url) {
        return [{ url: parsed.url }];
    }

    return [];
}

function dedupeMediaByUrl(mediaItems = []) {
    const seen = new Set();
    return mediaItems.filter((item) => {
        if (!item || !item.url) return false;
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
    });
}

const incidentController = {
    /**
     * Admin endpoint: create an incident for any truck/driver/helper.
     * Expects all IDs in the body and does not infer them from the logged-in user.
     */
    createIncidentAdmin: async (req, res) => {
        try {
            const {
                vanId,
                driverId,
                incidentTime,
                reportedAt,
                helperId,
                location,
                notes,
                vanRegistration,
                otherDriverName,
                otherDriverContactInfo,
                otherDriverEmail,
                otherDriverPhone,
                otherVehicleRegistration,
                isDriverInjured,
                canContinueWorking,
                isVehicleDrivable,
                needsRecoveryService,
                breakdownIssueType,
                canSelfFix,
                needsBreakdownAssistance,
                type, // 'accident' or 'breakdown'
            } = req.body;

            const user = req.user;
            const parsedType = type || 'breakdown';

            // Validate required fields
            if (!vanId || !driverId || !incidentTime) {
                return res.status(400).json({
                    message: 'vanId, driverId and incidentTime are required to create an incident.',
                });
            }

            if (!['accident', 'breakdown'].includes(parsedType)) {
                return res.status(400).json({
                    message: 'type must be either accident or breakdown.',
                });
            }

            if (!location || !notes) {
                return res.status(400).json({
                    message: 'location and notes are required.',
                });
            }

            if (
                (parsedType === 'accident' || parsedType === 'breakdown') &&
                parseBoolean(isVehicleDrivable) === undefined
            ) {
                return res.status(400).json({
                    message: 'isVehicleDrivable is required for accident and breakdown reports.',
                });
            }

            if (parsedType === 'breakdown' && !breakdownIssueType) {
                return res.status(400).json({
                    message: 'breakdownIssueType is required for breakdown reports.',
                });
            }

            // Build photo arrays from uploaded files (Cloudinary)
            const photos = getUploadedPhotos(req.files, 'photos');
            const vehicleMedia = getUploadedPhotos(req.files, 'vehicleMedia');
            const otherVehicleMedia = getUploadedPhotos(req.files, 'otherVehicleMedia');
            const otherLicenseMedia = getUploadedPhotos(req.files, 'otherLicenseMedia');
            const breakdownMedia = getUploadedPhotos(req.files, 'breakdownMedia');

            const steps = buildStepsFromTemplate(BREAKDOWN_TEMPLATE);

            const incident = await Incident.create({
                vanId,
                driverId,
                helperId,
                incidentTime,
                reportedAt: reportedAt || incidentTime,
                location,
                notes,
                vanRegistration,
                otherDriverName,
                otherDriverContactInfo,
                otherDriverEmail,
                otherDriverPhone,
                otherVehicleRegistration,
                isDriverInjured: parseBoolean(isDriverInjured),
                canContinueWorking: parseBoolean(canContinueWorking),
                isVehicleDrivable: parseBoolean(isVehicleDrivable),
                needsRecoveryService: parseBoolean(needsRecoveryService),
                breakdownIssueType,
                canSelfFix: parseBoolean(canSelfFix),
                needsBreakdownAssistance: parseBoolean(needsBreakdownAssistance),
                photos,
                vehicleMedia,
                otherVehicleMedia,
                otherLicenseMedia,
                breakdownMedia,
                steps,
                type: parsedType,
                createdBy: user && user._id ? user._id : undefined,
            });

            // Optional: notify all other admins that a new incident is active
            try {
                if (user && user._id) {
                    const otherAdmins = await User.find({
                        role: 'Admin',
                        _id: { $ne: user._id },
                    }).select('_id firstName lastName');

                    const senderName =
                        user.fullName ||
                        [user.firstName, user.lastName].filter(Boolean).join(' ') ||
                        'System';

                    await Promise.all(
                        otherAdmins.map((admin) =>
                            Notification.create({
                                userId: admin._id,
                                type: 'Incidents',
                                message: 'New incident created',
                                senderName,
                            })
                        )
                    );
                }
            } catch (notifyError) {
                // Do not fail incident creation if notification fails
                console.error('Error creating incident notification', notifyError);
            }

            res.status(201).json({
                message: 'Incident created successfully',
                incident,
            });
        } catch (error) {
            console.error('Error creating incident (admin)', error);
            res.status(500).json({
                message: 'Failed to create incident',
                error: error.message,
            });
        }
    },

    /**
     * Staff (driver / helper) endpoint: create an incident for the logged-in user.
     * - Uses req.user.truckId to infer the current truck and its vanId.
     * - If the user is a Driver, sets driverId = user._id.
     * - If the user is a Helper, sets helperId = user._id.
     * - Falls back to truck.driverId / truck.helperId where relevant.
     */
    createIncident: async (req, res) => {
        try {
            const {
                location,
                notes,
                reportedAt,
                vanRegistration,
                otherDriverName,
                otherDriverContactInfo,
                otherDriverEmail,
                otherDriverPhone,
                otherVehicleRegistration,
                isDriverInjured,
                canContinueWorking,
                isVehicleDrivable,
                needsRecoveryService,
                breakdownIssueType,
                canSelfFix,
                needsBreakdownAssistance,
                type, // 'accident' or 'breakdown'
            } = req.body;

            const user = req.user;
            const parsedType = type || 'breakdown';

            if (!user) {
                return res.status(401).json({
                    message: 'Unauthorized',
                });
            }

            if (!['accident', 'breakdown'].includes(parsedType)) {
                return res.status(400).json({
                    message: 'type must be either accident or breakdown.',
                });
            }

            if (!location || !notes) {
                return res.status(400).json({
                    message: 'location and notes are required.',
                });
            }

            if (
                (parsedType === 'accident' || parsedType === 'breakdown') &&
                parseBoolean(isVehicleDrivable) === undefined
            ) {
                return res.status(400).json({
                    message: 'isVehicleDrivable is required for accident and breakdown reports.',
                });
            }

            if (parsedType === 'breakdown' && !breakdownIssueType) {
                return res.status(400).json({
                    message: 'breakdownIssueType is required for breakdown reports.',
                });
            }

            const roles = Array.isArray(user.role) ? user.role : [];
            const isDriver = roles.includes('Driver');
            const isHelper = roles.includes('Helper');

            const userTruckId = user.truckId;
            if (!userTruckId) {
                return res.status(400).json({
                    message: 'No truck assigned to this user. Cannot create incident.',
                });
            }

            // Fetch driver/helper and van from the assigned truck, if any
            const truck = await Truck.findById(userTruckId).select('driverId helperId vanId');
            if (!truck || !truck.vanId) {
                return res.status(400).json({
                    message: 'No van linked to the assigned truck. Cannot create incident.',
                });
            }

            const vanId = truck.vanId;

            let driverId;
            let helperId;

            if (isDriver) {
                driverId = user._id;
            } else if (truck && truck.driverId) {
                driverId = truck.driverId;
            }

            if (isHelper) {
                helperId = user._id;
            } else if (truck && truck.helperId) {
                helperId = truck.helperId;
            }

            const incidentTime = new Date();

            // Build photo arrays from uploaded files (Cloudinary)
            const photos = getUploadedPhotos(req.files, 'photos');
            const vehicleMedia = getUploadedPhotos(req.files, 'vehicleMedia');
            const otherVehicleMedia = getUploadedPhotos(req.files, 'otherVehicleMedia');
            const otherLicenseMedia = getUploadedPhotos(req.files, 'otherLicenseMedia');
            const breakdownMedia = getUploadedPhotos(req.files, 'breakdownMedia');

            const steps = buildStepsFromTemplate(BREAKDOWN_TEMPLATE);

            // Optionally auto-complete the first step if we already have initial info
            maybeCompleteFirstStep(
                steps,
                notes,
                photos.concat(vehicleMedia, otherVehicleMedia, otherLicenseMedia, breakdownMedia),
                user._id
            );

            const incident = await Incident.create({
                vanId,
                driverId,
                helperId,
                incidentTime,
                reportedAt: reportedAt || incidentTime,
                location,
                notes,
                vanRegistration,
                otherDriverName,
                otherDriverContactInfo,
                otherDriverEmail,
                otherDriverPhone,
                otherVehicleRegistration,
                isDriverInjured: parseBoolean(isDriverInjured),
                canContinueWorking: parseBoolean(canContinueWorking),
                isVehicleDrivable: parseBoolean(isVehicleDrivable),
                needsRecoveryService: parseBoolean(needsRecoveryService),
                breakdownIssueType,
                canSelfFix: parseBoolean(canSelfFix),
                needsBreakdownAssistance: parseBoolean(needsBreakdownAssistance),
                photos,
                vehicleMedia,
                otherVehicleMedia,
                otherLicenseMedia,
                breakdownMedia,
                steps,
                type: parsedType,
                createdBy: user._id,
            });

            // Optional: notify admins that a new incident is active
            try {
                const admins = await User.find({ role: 'Admin' }).select('_id firstName lastName');
                const senderName =
                    user.fullName ||
                    [user.firstName, user.lastName].filter(Boolean).join(' ') ||
                    'System';

                await Promise.all(
                    admins.map((admin) =>
                        Notification.create({
                            userId: admin._id,
                            type: 'Incidents',
                            message: 'New incident created',
                            senderName,
                        })
                    )
                );
            } catch (notifyError) {
                // Do not fail incident creation if notification fails
                console.error('Error creating incident notification', notifyError);
            }

            res.status(201).json({
                message: 'Incident created successfully',
                incident,
            });
        } catch (error) {
            console.error('Error creating incident (staff)', error);
            res.status(500).json({
                message: 'Failed to create incident',
                error: error.message,
            });
        }
    },

    // List incidents with optional filters (status)
    listIncidents: async (req, res) => {
        try {
            const { status } = req.query;
            const query = {};
            if (status) query.status = status;

            const incidents = await Incident.find(query)
                .populate('vanId', 'name matricule')
                .populate('driverId', 'firstName lastName phone')
                .sort({ createdAt: -1 });

            res.status(200).json({
                message: 'Incidents retrieved successfully',
                incidents,
            });
        } catch (error) {
            console.error('Error listing incidents', error);
            res.status(500).json({
                message: 'Failed to retrieve incidents',
                error: error.message,
            });
        }
    },

    // Get single incident with steps
    getIncidentById: async (req, res) => {
        try {
            const { incidentId } = req.params;
            const incident = await Incident.findById(incidentId)
                .populate('vanId', 'name matricule')
                .populate('driverId', 'firstName lastName phone');

            if (!incident) {
                return res.status(404).json({ message: 'Incident not found' });
            }

            res.status(200).json({
                message: 'Incident retrieved successfully',
                incident,
            });
        } catch (error) {
            console.error('Error fetching incident', error);
            res.status(500).json({
                message: 'Failed to retrieve incident',
                error: error.message,
            });
        }
    },

    // Update basic incident fields and media arrays in a predictable way.
    // Media fields (`photos`, `vehicleMedia`, `otherVehicleMedia`, `otherLicenseMedia`, `breakdownMedia`):
    //   1) If a field is provided in body (array / JSON string / single URL), it is treated as the
    //      authoritative list from frontend (supports deletions) and normalized to [{ url }].
    //   2) Uploaded files for each field are appended.
    //   3) If a field is not provided and no uploads for it exist, existing values remain unchanged.
    updateIncident: async (req, res) => {
        try {
            const { incidentId } = req.params;
            const update = { ...req.body };

            const incident = await Incident.findById(incidentId);

            if (!incident) {
                return res.status(404).json({ message: 'Incident not found' });
            }

            const mediaFields = [
                'photos',
                'vehicleMedia',
                'otherVehicleMedia',
                'otherLicenseMedia',
                'breakdownMedia',
            ];

            const bodyMediaRaw = {};
            mediaFields.forEach((field) => {
                if (Object.prototype.hasOwnProperty.call(update, field)) {
                    bodyMediaRaw[field] = update[field];
                    delete update[field];
                }
            });

            // Apply primitive/body updates
            Object.assign(incident, update);

            mediaFields.forEach((field) => {
                const normalizedFromBody = normalizeMediaInput(bodyMediaRaw[field]);
                let baseMedia =
                    typeof normalizedFromBody !== 'undefined'
                        ? normalizedFromBody
                        : Array.isArray(incident[field])
                            ? incident[field].slice()
                            : [];

                const uploadedMedia = getUploadedPhotos(req.files, field);
                if (uploadedMedia.length > 0) {
                    baseMedia = baseMedia.concat(uploadedMedia);
                }

                incident[field] = dedupeMediaByUrl(baseMedia);
            });

            await incident.save();

            res.status(200).json({
                message: 'Incident updated successfully',
                incident,
            });
        } catch (error) {
            console.error('Error updating incident', error);
            res.status(500).json({
                message: 'Failed to update incident',
                error: error.message,
            });
        }
    },

    // Update an individual step status / data.
    // IMPORTANT: does NOT enforce that previous steps are completed first.
    // If, after the update, all required steps are DONE, the incident is automatically marked RESOLVED.
    updateStep: async (req, res) => {
        try {
            const { incidentId, stepId } = req.params;
            const { status, data } = req.body;

            const incident = await Incident.findById(incidentId);
            if (!incident) {
                return res.status(404).json({ message: 'Incident not found' });
            }

            const step = incident.steps.id(stepId);
            if (!step) {
                return res.status(404).json({ message: 'Step not found for incident' });
            }

            if (status) {
                step.status = status;
                if (status === 'DONE') {
                    step.completedAt = new Date();
                    if (req.user && req.user._id) {
                        step.completedBy = req.user._id;
                    }
                }
            }

            if (data !== undefined) {
                step.data = data;
            }

            // If all required steps are now DONE, auto-resolve the incident
            if (incident.canResolve()) {
                incident.status = 'RESOLVED';
            }

            await incident.save();

            res.status(200).json({
                message: 'Incident step updated successfully',
                incident,
            });
        } catch (error) {
            console.error('Error updating incident step', error);
            res.status(500).json({
                message: 'Failed to update incident step',
                error: error.message,
            });
        }
    },


    // Update the overall incident status (e.g. ACTIVE -> PENDING_RESOLUTION -> RESOLVED)
    updateStatus: async (req, res) => {
        try {
            const { incidentId } = req.params;
            const { status } = req.body;

            const incident = await Incident.findById(incidentId);
            if (!incident) {
                return res.status(404).json({ message: 'Incident not found' });
            }

            if (status === 'RESOLVED' && !incident.canResolve()) {
                return res.status(400).json({
                    message: 'Cannot resolve incident until all required steps are DONE',
                });
            }

            incident.status = status;
            await incident.save();

            res.status(200).json({
                message: 'Incident status updated successfully',
                incident,
            });
        } catch (error) {
            console.error('Error updating incident status', error);
            res.status(500).json({
                message: 'Failed to update incident status',
                error: error.message,
            });
        }
    },

    // Delete an incident by ID (admin-only via route middleware)
    deleteIncident: async (req, res) => {
        try {
            const { incidentId } = req.params;

            const incident = await Incident.findByIdAndDelete(incidentId);

            if (!incident) {
                return res.status(404).json({ message: 'Incident not found' });
            }

            return res.status(200).json({
                message: 'Incident deleted successfully',
            });
        } catch (error) {
            console.error('Error deleting incident', error);
            return res.status(500).json({
                message: 'Failed to delete incident',
                error: error.message,
            });
        }
    },
};

module.exports = incidentController;


