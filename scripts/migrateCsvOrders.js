require('dotenv').config();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');
const Task = require('../models/Task');
const StandardItem = require('../models/StandardItem');
// Register Truck model so Task hooks using mongoose.model('Truck') don't fail
require('../models/Truck');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI (ou MONGODB_URI) non défini dans .env');
  process.exit(1);
}

mongoose.set('strictQuery', false);
mongoose
  .connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => {
    console.error('Mongo connection error:', err);
    process.exit(1);
  });

// 🔁 Résout un item CSV → item Task (standard ou custom)
async function resolveItem(item) {
  const name = (item.itemName || '').trim();
  const quantity = Number(item.quantity || 1) || 1;
  const rawPrice = Number(item.itemCost || item.itemPrice || 0) || 0;

  // Pas de colonne Objectsposition dans le CSV, on utilise "Outside" par défaut
  let position = 'Outside';

  const nameLower = name.toLowerCase();
  const sku = (item.sku || '').toLowerCase();

  if (nameLower.includes('inside') || sku.includes('inside')) {
    if (nameLower.includes('dismantl') || sku.includes('dismantl')) {
      position = 'InsideWithDismantling';
    } else {
      position = 'Inside';
    }
  }

  if (!name) {
    console.warn('⚠️ Item sans nom, ignoré:', item);
    return null;
  }

  // Recherche du StandardItem par nom (case-insensitive, avec échappement regex)
  const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let standardItem = await StandardItem.findOne({
    itemName: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
  });

  // Si pas trouvé, essayer un nom nettoyé (ex: retirer parenthèses, slashs)
  if (!standardItem) {
    const cleanName = name
      .replace(/\s*\/\s*/g, ' ')
      .replace(/\s*\([^)]*\)\s*/g, '')
      .trim();

    if (cleanName && cleanName !== name) {
      standardItem = await StandardItem.findOne({
        itemName: { $regex: `^${escapeRegex(cleanName)}$`, $options: 'i' },
      });
    }
  }

  // ✅ Standard item trouvé
  if (standardItem) {
    let price = standardItem.price;

    if (position === 'Inside' && standardItem.insidePrice) {
      price = standardItem.insidePrice;
    }

    if (
      position === 'InsideWithDismantling' &&
      standardItem.insideWithDismantlingPrice
    ) {
      price = standardItem.insideWithDismantlingPrice;
    }

    return {
      standardItemId: standardItem._id,
      quantity,
      price,
      Objectsposition: position,
    };
  }

  // ❌ Custom item
  if (!item.sku || item.sku.trim() === '') {
    console.warn(`📦 Custom item (pas de SKU): "${name}"`);
  } else {
    console.warn(`📦 Custom item (non matché): "${name}" (SKU: ${item.sku})`);
  }

  return {
    standardItemId: null,
    object: name,
    quantity,
    price: rawPrice || 0,
    Objectsposition: position,
  };
}

// 🧱 Lit un CSV et reconstruit les ordres (1 ligne = 1 item, groupé par Order Number)
function loadOrdersFromCsv(csvFilePath) {
  return new Promise((resolve, reject) => {
    const ordersMap = new Map();

    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', row => {
        try {
          const orderNumber = (row['Order Number'] || '').toString().trim();
          if (!orderNumber) {
            console.warn('⚠️ Ligne sans Order Number, ignorée');
            return;
          }

          if (!ordersMap.has(orderNumber)) {
            const firstName = (row['First Name (Billing)'] || '').trim();
            const lastName = (row['Last Name (Billing)'] || '').trim();
            const phoneNumber = (row['Phone (Billing)'] || '').trim();
            const postcode = (row['Postcode (Billing)'] || '').trim();
            const totalPrice = Number(row['Order Total Amount'] || 0) || 0;
            const dateStr = row['Order Date'] || new Date().toISOString();

            let date = new Date();
            try {
              if (dateStr.includes(' ')) {
                const [datePart, timePart] = dateStr.split(' ');
                const [year, month, day] = datePart.split('-');
                const [hour, minute] = timePart.split(':');
                date = new Date(year, month - 1, day, hour || 0, minute || 0);
              } else {
                date = new Date(dateStr);
              }
            } catch (e) {
              console.warn(
                `⚠️ Date invalide pour order ${orderNumber}: ${dateStr}, utilisation de la date actuelle`,
              );
            }

            ordersMap.set(orderNumber, {
              orderNumber,
              firstName: firstName || 'N/A',
              lastName: lastName || 'N/A',
              phoneNumber: phoneNumber || 'N/A',
              postcode: postcode || 'N/A',
              totalPrice,
              date,
              customerNote: (row['Customer Note'] || '').trim(),
              items: [],
            });
          }

          const order = ordersMap.get(orderNumber);

          order.items.push({
            itemName: (row['Item Name'] || '').trim(),
            quantity: row['Quantity (- Refund)'] || 1,
            itemCost: row['Item Cost'] || 0,
            sku: (row['SKU'] || '').trim(),
          });
        } catch (e) {
          console.error('❌ Erreur de parsing ligne CSV:', e.message);
        }
      })
      .on('end', () => {
        console.log(`✅ CSV chargé. Nombre de commandes: ${ordersMap.size}`);
        resolve(Array.from(ordersMap.values()));
      })
      .on('error', err => {
        reject(err);
      });
  });
}

// 🚀 Migration principale
async function migrateFromCsv(csvFilePath, dryRun = false) {
  console.log('🚀 Début migration depuis CSV:', csvFilePath);
  if (dryRun) {
    console.log('🧪 MODE DRY-RUN: Aucun enregistrement ne sera créé');
  }

  const orders = await loadOrdersFromCsv(csvFilePath);
  let successCount = 0;
  let skipCount = 0;
  const customItems = new Set();

  for (const order of orders) {
    const resolvedItems = [];

    for (const oldItem of order.items) {
      const resolvedItem = await resolveItem(oldItem);
      if (resolvedItem) {
        resolvedItems.push(resolvedItem);
        if (!resolvedItem.standardItemId) {
          customItems.add(resolvedItem.object);
        }
      }
    }

    if (!resolvedItems.length) {
      console.warn(
        `⚠️ Aucun item valide pour la commande ${order.orderNumber}, sautée.`,
      );
      skipCount++;
      continue;
    }

    if (dryRun) {
      console.log(
        `🧪 [DRY-RUN] Order ${order.orderNumber}: ${resolvedItems.length} items`,
      );
      successCount++;
      continue;
    }

    try {
      const task = new Task({
        firstName: order.firstName,
        lastName: order.lastName,
        phoneNumber: order.phoneNumber,
        postcode: order.postcode,
        totalPrice: order.totalPrice || 0,
        date: order.date || new Date(),
        items: resolvedItems,
        createdByType: 'Admin',
        createdBy: 'MigrationScript',
        taskStatus: 'New',
        paymentStatus: 'Unpaid',
        additionalNotes: order.customerNote || undefined,
      });

      await task.save();
      console.log(
        `✅ Order ${order.orderNumber} → Task ${task.orderNumber} (${resolvedItems.length} items)`,
      );
      successCount++;
    } catch (error) {
      console.error(
        `❌ Erreur création Task pour order ${order.orderNumber}:`,
        error.message,
      );
      skipCount++;
    }
  }

  console.log('\n🎉 Migration terminée');
  console.log(`✅ ${successCount} commandes migrées`);
  if (skipCount > 0) {
    console.log(`⚠️ ${skipCount} commandes ignorées`);
  }
  if (customItems.size > 0) {
    console.log(`\n📦 ${customItems.size} items custom trouvés (non matchés):`);
    Array.from(customItems)
      .slice(0, 20)
      .forEach(item => console.log(`   - ${item}`));
    if (customItems.size > 20) {
      console.log(`   ... et ${customItems.size - 20} autres`);
    }
  }

  if (!dryRun) {
    process.exit(0);
  }
}

// --- CLI entrypoint ---
// Usage:
//   node scripts/migrateCsvOrders.js path/to/file.csv
//   node scripts/migrateCsvOrders.js path/to/file.csv --dry-run
const csvArg = process.argv[2];
const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--dry');

if (!csvArg) {
  console.error(
    '❌ Usage: node scripts/migrateCsvOrders.js path/to/orders.csv [--dry-run]',
  );
  process.exit(1);
}

const csvPath = path.resolve(csvArg);
if (!fs.existsSync(csvPath)) {
  console.error('❌ Fichier CSV introuvable:', csvPath);
  process.exit(1);
}

migrateFromCsv(csvPath, dryRun).catch(err => {
  console.error('❌ Migration error:', err);
  process.exit(1);
});


