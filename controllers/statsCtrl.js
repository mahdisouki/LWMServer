const Blog = require('../models/Blog');
const Payroll = require('../models/Payroll');
const Task = require('../models/Task');
const APIfeatures = require('../utils/APIFeatures'); // If you're using a utility for API features

const statsCtrl = {
    getAnnualPayrollSummary: async (req, res) => {
        try {
            const { year } = req.params; // Expect year as a URL parameter
            const startOfYear = new Date(`${year}-01-01`);
            const endOfYear = new Date(`${year}-12-31T23:59:59.999Z`);

            // Aggregate payroll data for the given year
            const summary = await Payroll.aggregate([
                {
                    $match: {
                        createdAt: { $gte: startOfYear, $lte: endOfYear }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalHoursWorked: { $sum: "$totalHoursWorked" },
                        regularHours: { $sum: "$regularHours" },
                        extraHours: { $sum: "$extraHours" },
                        totalSalary: { $sum: "$totalSalary" },
                        totalEntries: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        totalHoursWorked: 1,
                        regularHours: 1,
                        extraHours: 1,
                        totalSalary: 1,
                        totalEntries: 1
                    }
                }
            ]);

            // Send the summary in the response
            res.status(200).json({
                status: 'success',
                data: summary[0] || { message: "No payroll records found for this year." }
            });
        } catch (error) {
            console.error("Error retrieving annual payroll summary:", error);
            res.status(500).json({
                status: 'error',
                message: "Failed to retrieve annual payroll summary",
                error: error.message
            });
        }
    },
    getIncomeSummary: async (req, res) => {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const tomorrow = new Date(today);
            tomorrow.setDate(today.getDate() + 1);

            const dayAfterTomorrow = new Date(today);
            dayAfterTomorrow.setDate(today.getDate() + 2);

            // Aggregate incomes and total jobs for today, tomorrow, and day after tomorrow
            const incomeSummary = await Task.aggregate([
                {
                    $match: { paymentStatus: 'Paid' } // Only include tasks that are paid
                },
                {
                    $facet: {
                        todayIncome: [
                            {
                                $match: {
                                    date: { $gte: today, $lt: tomorrow }
                                }
                            },
                            {
                                $group: {
                                    _id: null,
                                    totalIncome: { $sum: "$price" },
                                    totalJobs: { $sum: 1 } // Count jobs for today
                                }
                            }
                        ],
                        tomorrowIncome: [
                            {
                                $match: {
                                    date: { $gte: tomorrow, $lt: dayAfterTomorrow }
                                }
                            },
                            {
                                $group: {
                                    _id: null,
                                    totalIncome: { $sum: "$price" }
                                }
                            }
                        ],
                        dayAfterTomorrowIncome: [
                            {
                                $match: {
                                    date: { $gte: dayAfterTomorrow }
                                }
                            },
                            {
                                $group: {
                                    _id: null,
                                    totalIncome: { $sum: "$price" }
                                }
                            }
                        ]
                    }
                }
            ]);

            // Format the response data
            res.status(200).json({
                status: 'success',
                data: {
                    todayIncome: incomeSummary[0].todayIncome[0]?.totalIncome || 0,
                    todayJobs: incomeSummary[0].todayIncome[0]?.totalJobs || 0,
                    tomorrowIncome: incomeSummary[0].tomorrowIncome[0]?.totalIncome || 0,
                    dayAfterTomorrowIncome: incomeSummary[0].dayAfterTomorrowIncome[0]?.totalIncome || 0
                }
            });
        } catch (error) {
            console.error("Error retrieving income summary:", error);
            res.status(500).json({
                status: 'error',
                message: "Failed to retrieve income summary",
                error: error.message
            });
        }
    },
};

module.exports = statsCtrl;
