require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');
const { User } = require('./models/User');
const Admin = require('./models/Admin');
const Driver = require('./models/Driver');
const Helper = require('./models/Helper');
const Truck = require('./models/Truck');
const Task = require('./models/Task');
const Dayoff = require('./models/Dayoff');
const TruckStatus = require('./models/TruckStatus');
const bcrypt = require('bcrypt');

const mongoURI = process.env.MONGODB_URI

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

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
// Helper function to generate a random location within Tunisia
function getRandomLocation() {
    const lat = 30.0 + Math.random() * (37.5 - 30.0);
    const lng = 7.0 + Math.random() * (12.0 - 7.0);
    return {
        type: "Point",
        coordinates: [lng, lat],
        address: `Random Location in Tunisia`
    };
}
async function createAdmin() {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash('password', saltRounds);

    const admin = new Admin({
      email: 'admin@wp.com',
      username: 'adminUser',
      password: hashedPassword,
      role: ['Admin'],
    });
    await admin.save();
    console.log('Admin created');
}

async function createTrucks() {
    const drivers = [];
    const helpers = [];
    const trucks = [];

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash('password', saltRounds);

    // Create 5 drivers and helpers
    for (let i = 0; i < 5; i++) {
        const driver = new Driver({
            email: `driver${i + 1}@wp.com`,
            username: `Walter White${i + 1}`,
            password: hashedPassword,
            picture: 'https://mir-s3-cdn-cf.behance.net/project_modules/hd/b51190101362045.5f1d68546ac50.jpg',
            role: ['Driver'],
            roleType: 'Driver',
        });

        const helper = new Helper({
            email: `helper${i + 1}@wp.com`,
            username: `Jesse Pinkman${i + 1}`,
            password: hashedPassword,
            picture: 'https://preview.redd.it/6l4c3ldptetb1.jpg?auto=webp&s=2835f8f76a1061d84ad051ec69a42fedb95b9e62',
            role: ['Helper'],
            roleType: 'Helper',
        });

        await driver.save();
        await helper.save();

        drivers.push(driver);
        helpers.push(helper);
    }

    // Create 5 trucks and assign drivers, helpers, and tasks
    for (let i = 0; i < 5; i++) {
        const task = new Task({
            firstName: `ClientFirstName${i + 1}`,
            lastName: `ClientLastName${i + 1}`,
            phoneNumber: `+123456789${i + 1}`,
            clientObjectPhotos: ['https://medleyhome.com/cdn/shop/files/rio-sofa-92-texture-oyster-02.jpg?v=1683918355&width=2048', 'https://images.thdstatic.com/productImages/f219c4b4-2bde-4b99-8be2-696fc239348d/svn/platinum-steel-magic-chef-top-freezer-refrigerators-mcdr740ste-64_600.jpg'],
            // initialConditionPhotos: [{
            //     items: ['https://example.com/initial1.jpg', 'https://example.com/initial2.jpg'],
            //     description: 'Initial condition of the truck.'
            // }],
            // finalConditionPhotos: [{
            //     items: ['https://example.com/final1.jpg', 'https://example.com/final2.jpg'],
            //     description: 'Final condition of the truck.'
            // }],
            // additionalItems: [{
            //     items: ['Item1', 'Item2'],
            //     description: 'Additional items in the truck.'
            // }],
            date: new Date(),
            hour: '14:00',
            object: 'Moving objects',
            price: 500,
            taskStatus: 'Processing',
            paymentStatus: 'Pending',
            additionalNotes: 'Handle with care.',
            location: getRandomLocation()
        });

        await task.save();

        const truck = new Truck({
            driverId: drivers[i]._id,
            helperId: helpers[i]._id,
            name: `Truck ${i + 1}`,
            loadCapacity: 1000 + i * 100,
            matricule: `TRUCK${i + 1}`,
            tasks: [task._id],
        });

        await truck.save();
        trucks.push(truck);
    }

    console.log('5 trucks, drivers, helpers, and tasks created.');
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

