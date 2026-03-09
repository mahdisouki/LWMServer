const BlueSheet = require('../models/BlueSheet');
const Truck = require('../models/Truck');
const Task = require('../models/Task');
const TippingRequest = require('../models/TippingRequest');
const PcnDamage = require('../models/PcnDamage');
const Payroll = require('../models/Payroll');
const DailySheet = require('../models/DailySheet');
const Driver = require('../models/Driver');
const Helper = require('../models/Helper');
const PaymentHistory = require('../models/PaymentHistory');

// Commission pool (fixed daily amount - usually £3,760)
const COMMISSION_POOL = 3760;

// Helper function to format date to YYYY-MM-DD
const formatDate = (date) => {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Parse any date input to UTC midnight (for consistent storage and query)
const toUTCMidnight = (dateInput) => {
  const d = new Date(dateInput);
  if (isNaN(d)) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
};

const blueSheetController = {
  // Generate blue sheets for all trucks for a specific date
  generateBlueSheetsForAllTrucks: async (req, res) => {
    try {
      // Parse and validate input date
      const inputDate = req.body.date ? new Date(req.body.date) : new Date();
      if (isNaN(inputDate)) {
        return res.status(400).json({ message: 'Invalid date format' });
      }
      const formattedDate = formatDate(inputDate);
      const dateObj = toUTCMidnight(formattedDate) || new Date(formattedDate + 'T00:00:00.000Z');
      const startOfDay = new Date(dateObj);
      const endOfDay = new Date(dateObj);
      endOfDay.setUTCHours(23, 59, 59, 999);

      // Get all trucks
      const trucks = await Truck.find().populate('driverId helperId');
      const blueSheets = [];
      const truckRouteTotals = [];

      // First pass: Calculate route totals for all trucks
      for (const truck of trucks) {
        let routeTotal = 0;
        const taskIdsForDate = [];

        // Get tasks for this truck and date
        if (truck.tasks) {
          let tasksForDate = [];
          if (truck.tasks instanceof Map) {
            tasksForDate = truck.tasks.get(formattedDate) || [];
          } else if (typeof truck.tasks === 'object') {
            tasksForDate = truck.tasks[formattedDate] || [];
          }

          // Extract task IDs
          if (Array.isArray(tasksForDate)) {
            const taskIds = tasksForDate
              .map(task => {
                if (typeof task === 'string') return task;
                if (task && task.taskId && (task.type === 'task' || task.type === 'Task')) {
                  return task.taskId;
                }
                return null;
              })
              .filter(id => id !== null);

            taskIdsForDate.push(...taskIds);
          }
        }

        // Get tasks for this truck and date (includes paid, partial paid, and unpaid)
        const tasks = await Task.find({
          _id: { $in: taskIdsForDate },
          paymentStatus: { $in: ['Paid', 'partial_Paid', 'Unpaid'] }, // Fixed: 'Unpaid' with capital U
          date: { $gte: startOfDay, $lt: endOfDay },
        });

        // Calculate route total (sum of all task prices for this van route)
        routeTotal = tasks.reduce((sum, task) => sum + (task.totalPrice || 0), 0);

        truckRouteTotals.push({
          truckId: truck._id,
          routeTotal,
        });
      }

      // Calculate total route total for all trucks (this is totalIn - Column B)
      const totalIn = truckRouteTotals.reduce((sum, t) => sum + t.routeTotal, 0);
      
      console.log('📊 BlueSheet Calculation Debug:');
      console.log('Total trucks:', trucks.length);
      console.log('Truck route totals:', truckRouteTotals);
      console.log('Total In (sum of all route totals):', totalIn);

      // Tipping: use tipdate when set (day the tip applies to), else fall back to createdAt
      const tippingDateFilter = {
        $or: [
          { tipdate: { $gte: startOfDay, $lt: endOfDay } },
          {
            $and: [
              { $or: [{ tipdate: null }, { tipdate: { $exists: false } }] },
              { createdAt: { $gte: startOfDay, $lt: endOfDay } },
            ],
          },
        ],
      };

      // Second pass: Generate blue sheets for each truck
      for (const truck of trucks) {
        const truckData = truckRouteTotals.find(t => t.truckId.toString() === truck._id.toString());
        const routeTotal = truckData ? truckData.routeTotal : 0;

        // Calculate commission percentage and amount (Column E and F)
        let commissionPercentage = 0;
        let commission = 0;
        if (totalIn > 0) {
          commissionPercentage = routeTotal / totalIn; // Column E: Percentage commission (D / B)
          commission = commissionPercentage * COMMISSION_POOL; // Column F: Commission Paid day (E * C)
          
          console.log(`Truck ${truck.name || truck._id}: routeTotal=${routeTotal}, totalIn=${totalIn}, commissionPercentage=${commissionPercentage}, commission=${commission}`);
        } else {
          console.log(`⚠️ TotalIn is 0 - cannot calculate commission percentage for truck ${truck.name || truck._id}`);
        }

        // Get tipping for this day (Column G: Tipping for this day)
        let tipping = 0;
        if (truck.driverId || truck.helperId) {
          const userIds = [];
          if (truck.driverId) userIds.push(truck.driverId._id || truck.driverId);
          if (truck.helperId) userIds.push(truck.helperId._id || truck.helperId);

          const tippingRequests = await TippingRequest.find({
            userId: { $in: userIds },
            status: 'Accepted',
            ...tippingDateFilter,
          });

          tipping = tippingRequests.reduce((sum, tr) => sum + (tr.price || 0), 0);
        }

        // Get van hire and insurance from truck
        const vanHire = truck.vanHire || 0;
        const insurance = truck.insurance || 0;

        // Get driver OT (extraHours * extraHourPrice)
        let driverOT = 0;
        if (truck.driverId) {
          const driverId = truck.driverId._id || truck.driverId;
          const driverPayroll = await Payroll.findOne({
            userId: driverId,
            truckId: truck._id,
            startTime: { $gte: startOfDay, $lt: endOfDay },
          }).populate('userId');

          if (driverPayroll && driverPayroll.extraHours) {
            const driver = await Driver.findById(driverId);
            if (driver && driver.extraHourPrice) {
              driverOT = driverPayroll.extraHours * driver.extraHourPrice;
            }
          }
        }

        // Get helper OT (extraHours * extraHourPrice)
        let labourOT = 0;
        if (truck.helperId) {
          const helperId = truck.helperId._id || truck.helperId;
          const helperPayroll = await Payroll.findOne({
            userId: helperId,
            truckId: truck._id,
            startTime: { $gte: startOfDay, $lt: endOfDay },
          }).populate('userId');

          if (helperPayroll && helperPayroll.extraHours) {
            const helper = await Helper.findById(helperId);
            if (helper && helper.extraHourPrice) {
              labourOT = helperPayroll.extraHours * helper.extraHourPrice;
            }
          }
        }

        // Get fuel from DailySheet (sum of fuelLogs amounts) for this truck and date
        let fuel = 0;
        const dailySheetForFuel = await DailySheet.findOne({
          truckId: truck._id,
          date: { $gte: startOfDay, $lt: endOfDay },
        });
        if (dailySheetForFuel && dailySheetForFuel.fuelLogs && dailySheetForFuel.fuelLogs.length > 0) {
          fuel = dailySheetForFuel.fuelLogs.reduce((sum, log) => sum + (log.amount || 0), 0);
        }

        // Get tasks for this date
        let taskIdsForDate = [];
        if (truck.tasks) {
          let tasksForDate = [];
          if (truck.tasks instanceof Map) {
            tasksForDate = truck.tasks.get(formattedDate) || [];
          } else if (typeof truck.tasks === 'object') {
            tasksForDate = truck.tasks[formattedDate] || [];
          }

          if (Array.isArray(tasksForDate)) {
            taskIdsForDate = tasksForDate
              .map(task => {
                if (typeof task === 'string') return task;
                if (task && task.taskId && (task.type === 'task' || task.type === 'Task')) {
                  return task.taskId;
                }
                return null;
              })
              .filter(id => id !== null);
          }
        }

        // Calculate Stripe commission (1.4% + 20p per transaction)
        let stripeCom = 0;
        if (taskIdsForDate.length > 0) {
          const stripePayments = await PaymentHistory.find({
            taskId: { $in: taskIdsForDate },
            paymentType: 'Stripe',
            paymentDate: { $gte: startOfDay, $lt: endOfDay },
          });

          stripeCom = stripePayments.reduce((sum, payment) => {
            // Stripe amounts are stored in cents, convert to GBP
            const amountInGBP = payment.amount / 100;
            const commission = (amountInGBP * 0.014) + 0.20; // 1.4% + 20p
            return sum + commission;
          }, 0);
        }

        // Calculate PayPal commission (2.9% + 30p per transaction)
        let paypalComi = 0;
        if (taskIdsForDate.length > 0) {
          const paypalPayments = await PaymentHistory.find({
            taskId: { $in: taskIdsForDate },
            paymentType: 'PayPal',
            paymentDate: { $gte: startOfDay, $lt: endOfDay },
          });

          paypalComi = paypalPayments.reduce((sum, payment) => {
            // PayPal amounts are stored in GBP directly
            const amountInGBP = payment.amount;
            const commission = (amountInGBP * 0.029) + 0.30; // 2.9% + 30p
            return sum + commission;
          }, 0);
        }

        // Calculate otherCosts (Column J: combines vanHire, insurance, driverOT, labourOT, stripeCom, paypalComi)
        const otherCosts = (vanHire || 0) + 
                          (insurance || 0) + 
                          (driverOT || 0) + 
                          (labourOT || 0) + 
                          (stripeCom || 0) + 
                          (paypalComi || 0);

        // Get tipping request IDs for this date (same tipdate/createdAt logic as tipping total)
        let tippingRequestIds = [];
        if (truck.driverId || truck.helperId) {
          const userIds = [];
          if (truck.driverId) userIds.push(truck.driverId._id || truck.driverId);
          if (truck.helperId) userIds.push(truck.helperId._id || truck.helperId);

          const tippingRequests = await TippingRequest.find({
            userId: { $in: userIds },
            ...tippingDateFilter,
          });

          tippingRequestIds = tippingRequests.map(tr => tr._id);
        }

        // Get PCN/Damages for this truck and date (via this truck's DailySheet)
        let pcnDamageIds = [];
        let pcnDamageTotal = 0;
        const dailySheetForPcn = await DailySheet.findOne({
          truckId: truck._id,
          date: { $gte: startOfDay, $lte: endOfDay },
        });
        if (dailySheetForPcn) {
          const pcnDamages = await PcnDamage.find({ dailySheetId: dailySheetForPcn._id });
          pcnDamageIds = pcnDamages.map(p => p._id);
          pcnDamageTotal = pcnDamages.reduce((sum, p) => sum + (p.amount || 0), 0);
        }

        // Create or update blue sheet
        const blueSheet = await BlueSheet.findOneAndUpdate(
          { truckId: truck._id, date: dateObj },
          {
            truckId: truck._id,
            date: dateObj,
            totalIn, // Column B: Total In (all vans combined)
            totalCommissionPool: COMMISSION_POOL, // Column C: Commission would charge
            routeTotal, // Column D: TEAM 3 route
            commissionPercentage, // Column E: Percentage commission
            commission, // Column F: Commission Paid day
            tipping, // Column G: Tipping for this day
            fuel, // Column H: FUEL
            pcnDamage: pcnDamageTotal, // Column I: PCN (from linked PcnDamage records)
            otherCosts, // Column J: Other costs
            // Profit (Column K) is calculated in pre-save hook
            tasks: taskIdsForDate,
            tippingRequests: tippingRequestIds,
            pcnDamages: pcnDamageIds,
          },
          { new: true, upsert: true }
        );

        // Profit is calculated in pre-save hook, but let's ensure it's set
        await blueSheet.save();

        blueSheets.push(blueSheet);
      }

      res.status(201).json({
        message: 'Blue sheets generated successfully',
        blueSheets,
        totalIn, // Total of all vans combined
        totalCommissionPool: COMMISSION_POOL,
      });
    } catch (error) {
      console.error('Error generating blue sheets:', error);
      res.status(500).json({
        message: 'Error generating blue sheets',
        error: error.message || 'Unknown error occurred',
      });
    }
  },

  // Get blue sheet for a specific truck and date
  getBlueSheetForTruck: async (req, res) => {
    try {
      const { truckId } = req.params;
      const { date } = req.query;

      if (!date) {
        return res.status(400).json({ message: 'Date parameter is required' });
      }

      const dateObj = toUTCMidnight(date);
      if (!dateObj) {
        return res.status(400).json({ message: 'Invalid date format' });
      }

      const blueSheet = await BlueSheet.findOne({
        truckId,
        date: dateObj,
      })
        .populate('truckId', 'name matricule driverId helperId')
        .populate('tasks')
        .populate('tippingRequests')
        .populate('pcnDamages');

      if (!blueSheet) {
        return res.status(404).json({ message: 'Blue sheet not found for this truck and date' });
      }

      res.status(200).json({
        message: 'Blue sheet retrieved successfully',
        blueSheet,
      });
    } catch (error) {
      console.error('Error retrieving blue sheet:', error);
      res.status(500).json({
        message: 'Error retrieving blue sheet',
        error: error.message || 'Unknown error occurred',
      });
    }
  },

  // Get all blue sheets for a specific date
  getBlueSheetsForDate: async (req, res) => {
    try {
      const { date } = req.query;

      if (!date) {
        return res.status(400).json({ message: 'Date parameter is required' });
      }

      const dateObj = toUTCMidnight(date);
      if (!dateObj) {
        return res.status(400).json({ message: 'Invalid date format' });
      }

      const blueSheets = await BlueSheet.find({
        date: dateObj,
      })
        .populate('truckId', 'name matricule driverId helperId')
        .populate('pcnDamages')
        .sort({ 'truckId.name': 1 });

      res.status(200).json({
        message: 'Blue sheets retrieved successfully',
        blueSheets,
        date: formatDate(dateObj),
      });
    } catch (error) {
      console.error('Error retrieving blue sheets:', error);
      res.status(500).json({
        message: 'Error retrieving blue sheets',
        error: error.message || 'Unknown error occurred',
      });
    }
  },

  // Sync pcnDamages array and pcnDamage total for the BlueSheet linked to this DailySheet (used when PCN/Damage add/update/delete)
  syncBlueSheetPcnDamages: async (dailySheetId) => {
    const DailySheet = require('../models/DailySheet');
    const PcnDamage = require('../models/PcnDamage');
    const Truck = require('../models/Truck');
    const dailySheet = await DailySheet.findById(dailySheetId).select('driverId date truckId');
    if (!dailySheet) return;
    const truck = dailySheet.truckId
      ? await Truck.findById(dailySheet.truckId)
      : await Truck.findOne({ driverId: dailySheet.driverId });
    if (!truck) return;
    const dateObj = toUTCMidnight(dailySheet.date);
    if (!dateObj) return;
    const blueSheet = await BlueSheet.findOne({ truckId: truck._id, date: dateObj });
    if (!blueSheet) return;
    const pcnDamages = await PcnDamage.find({ dailySheetId });
    blueSheet.pcnDamages = pcnDamages.map(p => p._id);
    blueSheet.pcnDamage = pcnDamages.reduce((sum, p) => sum + (p.amount || 0), 0);
    await blueSheet.save();
  },

  // Update blue sheet (for manual updates like PCN/DAMAGE, otherCosts, etc.)
  updateBlueSheet: async (req, res) => {
    try {
      const { blueSheetId } = req.params;
      const { pcnDamage, otherCosts } = req.body;

      const blueSheet = await BlueSheet.findById(blueSheetId);

      if (!blueSheet) {
        return res.status(404).json({ message: 'Blue sheet not found' });
      }

      // Update only provided fields
      if (pcnDamage !== undefined) blueSheet.pcnDamage = pcnDamage;
      if (otherCosts !== undefined) blueSheet.otherCosts = otherCosts;

      // Profit will be recalculated in pre-save hook
      await blueSheet.save();

      res.status(200).json({
        message: 'Blue sheet updated successfully',
        blueSheet,
      });
    } catch (error) {
      console.error('Error updating blue sheet:', error);
      res.status(500).json({
        message: 'Error updating blue sheet',
        error: error.message || 'Unknown error occurred',
      });
    }
  },
};

module.exports = blueSheetController;
