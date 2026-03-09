const Incident = require('../models/Incident');
const Notification = require('../models/Notification');

// Static breakdown procedure definition – mirrors your paper checklist
const BREAKDOWN_TEMPLATE = [
    { order: 1, title: 'Identify the issue', required: true },
    {
        order: 2,
        title: 'Back office receives notification',
        required: true,
    },
    {
        order: 3,
        title: 'Contact Radius to arrange recovery',
        required: true,
    },
    {
        order: 4,
        title: 'Arrange taxi / record van recovery',
        required: true,
    },
    {
        order: 5,
        title: 'Contact VAL to request replacement van',
        required: true,
    },
    {
        order: 6,
        title: 'Provide driver and vehicle details',
        required: true,
    },
    {
        order: 7,
        title: 'Complete insurance process and send proof',
        required: true,
    },
    {
        order: 8,
        title: 'Add van to congestion account',
        required: false,
    },
    {
        order: 9,
        title: 'Update Adam on progress',
        required: false,
    },
    {
        order: 10,
        title: 'Liaise with teams about replacement van',
        required: false,
    },
    {
        order: 11,
        title: 'Update back office van management',
        required: false,
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

const incidentController = {
    // Create a new incident (typically from driver app)
    createIncident: async (req, res) => {
        try {
            const { truckId, driverId, incidentTime, location, notes, photos = [] } = req.body;

            const steps = buildStepsFromTemplate(BREAKDOWN_TEMPLATE);

            // Optionally auto-complete the first step if we already have initial info
            if (notes || (Array.isArray(photos) && photos.length > 0)) {
                const firstStep = steps.find((s) => s.order === 1);
                if (firstStep) {
                    firstStep.status = 'DONE';
                    firstStep.completedAt = new Date();
                    if (req.user && req.user._id) {
                        firstStep.completedBy = req.user._id;
                    }
                }
            }

            const incident = await Incident.create({
                truckId,
                driverId,
                incidentTime,
                location,
                notes,
                photos,
                steps,
            });

            // Optional: notify admins that a new incident is active
            try {
                await Notification.create({
                    userId: req.user && req.user._id ? req.user._id : driverId,
                    type: 'Incidents',
                    message: 'New incident created',
                    senderName: req.user && req.user.fullName ? req.user.fullName : 'System',
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
            console.error('Error creating incident', error);
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
                .populate('driverId', 'fullName phone')
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
                .populate('driverId', 'fullName phone');

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

    // Update basic incident fields (location, notes, photos, etc.)
    updateIncident: async (req, res) => {
        try {
            const { incidentId } = req.params;
            const update = req.body;

            const incident = await Incident.findByIdAndUpdate(incidentId, update, {
                new: true,
            });

            if (!incident) {
                return res.status(404).json({ message: 'Incident not found' });
            }

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


