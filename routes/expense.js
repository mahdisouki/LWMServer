const express = require("express");
const router = express.Router();
const expenseController = require("../controllers/expenseController");
const parser = require('../middlewares/multer');

// Get all expenses (with optional filters: driverId, from, to, addedBy)
router.get('/', expenseController.getAllExpenses);

// Get expenses for a specific driver and date
router.get('/:driverId/:date', expenseController.getExpensesForDriverAndDate);

// Create a new expense linked to a daily sheet (body: driverId, date, reason, amount, etc.)
router.post('/', parser.single('receipt'), expenseController.addExpense);

// Update an expense by ID
router.patch('/:expenseId', parser.single('receipt'), expenseController.updateExpense);

// Delete an expense by ID
router.delete('/:expenseId', expenseController.deleteExpense);

module.exports = router;



