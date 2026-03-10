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
        const firstStep = steps.find((s) => s.order === 1);
        if (firstStep) {
            firstStep.status = 'DONE';
            firstStep.completedAt = new Date();
            if (userId) {
                firstStep.completedBy = userId;
            }
        }
    }
}

const incidentController = {
    /**
     * Admin endpoint: create an incident for any truck/driver/helper.
     * Expects all IDs in the body and does not infer them from the logged-in user.
     */
    createIncidentAdmin: async (req, res) => {
        try {
            const {
                truckId,
                driverId,
                incidentTime,
                helperId,
                location,
                notes,
                type, // 'incident' or 'breakdown'
            } = req.body;

            const user = req.user;

            // Validate required fields
            if (!truckId || !driverId || !incidentTime) {
                return res.status(400).json({
                    message: 'truckId, driverId and incidentTime are required to create an incident.',
                });
            }

            // Build photos array from uploaded files (Cloudinary) if present
            let photos = [];
            if (Array.isArray(req.files) && req.files.length > 0) {
                photos = req.files
                    .filter((file) => !!file.path)
                    .map((file) => ({
                        url: file.path,
                    }));
            }

            const steps = buildStepsFromTemplate(BREAKDOWN_TEMPLATE);

            const incident = await Incident.create({
                truckId,
                driverId,
                helperId,
                incidentTime,
                location,
                notes,
                photos,
                steps,
                type, // will fall back to schema default if undefined
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
     * - Uses req.user.truckId as the truck.
     * - If the user is a Driver, sets driverId = user._id.
     * - If the user is a Helper, sets helperId = user._id.
     * - Falls back to truck.driverId / truck.helperId where relevant.
     */
    createIncident: async (req, res) => {
        try {
            const {
                location,
                notes,
                type, // 'incident' or 'breakdown'
            } = req.body;

            const user = req.user;

            if (!user) {
                return res.status(401).json({
                    message: 'Unauthorized',
                });
            }

            const roles = Array.isArray(user.role) ? user.role : [];
            const isDriver = roles.includes('Driver');
            const isHelper = roles.includes('Helper');

            let truckId = user.truckId;
            if (!truckId) {
                return res.status(400).json({
                    message: 'No truck assigned to this user. Cannot create incident.',
                });
            }

            // Fetch driver/helper from the assigned truck, if any
            const truck = await Truck.findById(truckId).select('driverId helperId');

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

            // Build photos array from uploaded files (Cloudinary) if present
            let photos = [];
            if (Array.isArray(req.files) && req.files.length > 0) {
                photos = req.files
                    .filter((file) => !!file.path)
                    .map((file) => ({
                        url: file.path,
                    }));
            }

            const steps = buildStepsFromTemplate(BREAKDOWN_TEMPLATE);

            // Optionally auto-complete the first step if we already have initial info
            maybeCompleteFirstStep(steps, notes, photos, user._id);

            const incident = await Incident.create({
                truckId,
                driverId,
                helperId,
                incidentTime,
                location,
                notes,
                photos,
                steps,
                type, // will fall back to schema default if undefined
                createdBy: user._id,
            });

            // Optional: notify admins that a new incident is active
            try {
                await Notification.create({
                    userId: user._id,
                    type: 'Incidents',
                    message: 'New incident created',
                    senderName: user.fullName || 'System',
                });
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
                .populate('truckId', 'name matricule')
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
                .populate('truckId', 'name matricule')
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

    // Update basic incident fields (location, notes, etc.) and handle photos in a predictable way.
    // - Body fields update primitives as usual.
    // - Photos follow this logic:
    //   1) If `photos` is provided in the body (array / JSON string / single URL), it is treated as
    //      the *authoritative* list from the frontend (supports deletions). This becomes the base set.
    //   2) Any uploaded files in `req.files` (field: "photos") are *appended* to that base set.
    //   3) If no `photos` in body and no files are uploaded, existing photos remain unchanged.
    updateIncident: async (req, res) => {
        try {
            const { incidentId } = req.params;
            const update = { ...req.body };

            const incident = await Incident.findById(incidentId);

            if (!incident) {
                return res.status(404).json({ message: 'Incident not found' });
            }

            // Extract any photos from the body; they represent the remaining photos as seen by the frontend.
            // We'll convert them into a base array and THEN append any newly uploaded files.
            let bodyPhotosRaw;
            if (Object.prototype.hasOwnProperty.call(update, 'photos')) {
                bodyPhotosRaw = update.photos;
                delete update.photos;
            }

            // Apply primitive/body updates
            Object.assign(incident, update);

            // Build base photos:
            // - If body provided `photos`, normalize and use that (supports deletions).
            // - Otherwise, start from existing incident.photos.
            let basePhotos;

            if (typeof bodyPhotosRaw !== 'undefined') {
                let parsed = bodyPhotosRaw;

                // Accept JSON string or array
                if (typeof bodyPhotosRaw === 'string') {
                    try {
                        const tmp = JSON.parse(bodyPhotosRaw);
                        parsed = tmp;
                    } catch {
                        // If not valid JSON, treat as single URL string
                        parsed = bodyPhotosRaw ? [bodyPhotosRaw] : [];
                    }
                }

                if (Array.isArray(parsed)) {
                    // Array of URLs or objects; normalize to [{ url }]
                    basePhotos = parsed
                        .filter(Boolean)
                        .map((item) =>
                            typeof item === 'string'
                                ? { url: item }
                                : item && item.url
                                    ? { url: item.url }
                                    : null
                        )
                        .filter(Boolean);
                } else if (parsed && typeof parsed === 'object' && parsed.url) {
                    basePhotos = [{ url: parsed.url }];
                } else {
                    // Explicitly clear photos if body indicates no remaining ones
                    basePhotos = [];
                }
            } else {
                // No photos provided in body -> keep existing as base
                basePhotos = Array.isArray(incident.photos) ? incident.photos.slice() : [];
            }

            // Append new photos from uploaded files (Cloudinary) if present
            if (Array.isArray(req.files) && req.files.length > 0) {
                const uploadedPhotos = req.files
                    .filter((file) => !!file.path)
                    .map((file) => ({
                        url: file.path,
                    }));

                basePhotos = basePhotos.concat(uploadedPhotos);
            }

            // De-duplicate by URL and assign back
            if (basePhotos) {
                const seen = new Set();
                incident.photos = basePhotos.filter((p) => {
                    if (!p || !p.url) return false;
                    if (seen.has(p.url)) return false;
                    seen.add(p.url);
                    return true;
                });
            }

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
};

module.exports = incidentController;


