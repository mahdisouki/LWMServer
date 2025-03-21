require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');
const bcrypt = require('bcrypt');
const { User } = require('./models/User');
const Admin = require('./models/Admin');
const Driver = require('./models/Driver');
const Helper = require('./models/Helper');
const Truck = require('./models/Truck');
const Task = require('./models/Task');
const Dayoff = require('./models/Dayoff');
const TruckStatus = require('./models/TruckStatus');

const mongoURI = process.env.MONGODB_URI;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

mongoose.connect(mongoURI)
    .then(() => promptUser())
    .catch(err => console.error('Database connection error:', err));

async function truncateDatabase() {
    console.log('Deleting all existing data...');
    await User.deleteMany({});
    await Admin.deleteMany({});
    await Driver.deleteMany({});
    await Helper.deleteMany({});
    await Truck.deleteMany({});
    await Task.deleteMany({});
    await Dayoff.deleteMany({});
    await TruckStatus.deleteMany({});
    console.log('All data deleted.');
}

function getRandomLocation() {
    const lat = 51.286760 + Math.random() * (51.691874 - 51.286760);
    const lng = -0.510375 + Math.random() * (0.334015 - -0.510375);
    return { type: "Point", coordinates: [lng, lat], address: `Random Location in London` };
}

async function createAdmin() {
    const hashedPassword = await bcrypt.hash('password', 10);
    const admin = new Admin({ email: 'admin@wp.com', username: 'adminUser', password: hashedPassword, role: ['Admin'] });
    await admin.save();
    console.log('Admin created');
}

async function createTrucks() {
    const drivers = [];
    const helpers = [];
    const trucks = [];
    const hashedPassword = await bcrypt.hash('password', 10);

    for (let i = 0; i < 5; i++) {
        const driver = new Driver({ email: `driver${i + 1}@wp.com`, username: `Driver${i + 1}`, password: hashedPassword, role: ['Driver'], roleType: 'Driver' });
        const helper = new Helper({ email: `helper${i + 1}@wp.com`, username: `Helper${i + 1}`, password: hashedPassword, role: ['Helper'], roleType: 'Helper' });
        await driver.save();
        await helper.save();
        drivers.push(driver);
        helpers.push(helper);
    }

    const tasksPerTruck = 5;
    const allTasks = [];

    for (let i = 0; i < 20; i++) {
        const task = new Task({
            firstName: `Client${i + 1}`,
            lastName: `Last${i + 1}`,
            phoneNumber: `+123456789${i + 1}`,
            clientObjectPhotos: ['https://example.com/photo1.jpg', 'https://example.com/photo2.jpg'],
            date: new Date(),
            available: 'AnyTime',
            location: getRandomLocation(),
            totalPrice: 500,
            postcode :'5090',
            taskStatus: 'Processing',
            paymentStatus: 'Pending',
            items: [],
        });
        await task.save();
        allTasks.push(task);
    }

    for (let i = 0; i < 5; i++) {
        const truckTasks = {};
        const truckTaskSlice = allTasks.slice(i * tasksPerTruck, (i + 1) * tasksPerTruck);
        truckTaskSlice.forEach(task => {
            const taskDate = task.date.toISOString().split('T')[0];
            if (!truckTasks[taskDate]) truckTasks[taskDate] = [];
            truckTasks[taskDate].push(task._id);
        });

        const truck = new Truck({
            driverId: drivers[i]._id,
            driverSpecificDays: { startDate: new Date(), endDate: new Date() },
            helperId: helpers[i]._id,
            helperSpecificDays: { startDate: new Date(), endDate: new Date() },
            name: `Truck ${i + 1}`,
            loadCapacity: 1000 + i * 100,
            matricule: `TRUCK${i + 1}`,
            tasks: truckTasks,
        });
        await truck.save();
        trucks.push(truck);
    }

    console.log('Trucks, drivers, helpers, and tasks created.');
}

async function seedDatabase() {
    await createAdmin();
    await createTrucks();
    mongoose.disconnect();
}

function promptUser() {
    rl.question('Are you sure you want to delete all existing data? (yes/no): ', async (answer) => {
        if (answer.toLowerCase() === 'yes') {
            await truncateDatabase();
            await seedDatabase();
        } else {
            console.log('Seeding process canceled.');
            mongoose.disconnect();
        }
        rl.close();
    });
}
