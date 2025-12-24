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
async function resolveItem(item, verbose = false) {
  const name = (item.itemName || '').trim();
  const quantity = Number(item.quantity || 1) || 1;
  const rawPrice = Number(item.itemCost || item.itemPrice || 0) || 0;

  // Détermine Objectsposition depuis le CSV ou utilise "Outside" par défaut
  let position = 'Outside';
  if (item.Objectsposition) {
    const pos = String(item.Objectsposition).trim();
    if (['Inside', 'Outside', 'InsideWithDismantling'].includes(pos)) {
      position = pos;
    }
  } else {
    // Fallback: détecte depuis le nom ou SKU
    const nameLower = name.toLowerCase();
    const sku = (item.sku || '').toLowerCase();
    
    if (nameLower.includes('inside') || sku.includes('inside')) {
      if (nameLower.includes('dismantl') || sku.includes('dismantl')) {
        position = 'InsideWithDismantling';
      } else {
        position = 'Inside';
      }
    }
  }

  if (!name) {
    if (verbose) console.warn('⚠️ Item sans nom, ignoré:', item);
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

  // ✅ STANDARD ITEM TROUVÉ
  if (standardItem) {
    let price = standardItem.price; // Prix par défaut (Outside)

    // Utilise le prix selon la position
    if (position === 'Inside' && standardItem.insidePrice) {
      price = standardItem.insidePrice;
    } else if (
      position === 'InsideWithDismantling' &&
      standardItem.insideWithDismantlingPrice
    ) {
      price = standardItem.insideWithDismantlingPrice;
    }

    if (verbose) {
      console.log(`✅ Standard item: "${name}" → ${standardItem.itemName} (qty: ${quantity}, price: £${price}, pos: ${position})`);
    }

    return {
      standardItemId: standardItem._id,
      quantity,
      price,
      Objectsposition: position,
      // Note: pas de champ 'object' pour les standard items
    };
  }

  // ❌ CUSTOM ITEM (non trouvé dans StandardItem)
  if (verbose) {
    const skuInfo = item.sku ? ` (SKU: ${item.sku})` : ' (pas de SKU)';
    console.warn(`📦 Custom item (non matché): "${name}"${skuInfo} → sera créé avec object + price`);
  }

  return {
    standardItemId: null, // Explicitement null pour custom items
    object: name, // Le nom original devient 'object' pour custom items
    quantity,
    price: rawPrice || 0, // Utilise le prix du CSV pour custom items
    Objectsposition: position,
    // Note: pas de standardItemId pour les custom items
  };
}

// 🗺️ Mappe le statut de paiement WordPress → Task paymentStatus
function mapPaymentStatus(orderStatus) {
  const status = (orderStatus || '').toLowerCase();

  if (status.includes('completed')) {
    return 'Paid';
  }

  // Processing signifie aussi que c'est payé
  if (status.includes('processing')) {
    return 'Paid';
  }

  if (status.includes('partial paid') || status.includes('partial')) {
    return 'partial_Paid';
  }

  if (status.includes('refunded')) {
    return 'refunded';
  }

  if (status.includes('failed')) {
    return 'Failed';
  }

  if (status.includes('on hold')) {
    return 'Unpaid';
  }

  if (status.includes('pending payment')) {
    return 'Unpaid';
  }

  return 'Unpaid';
}

// 🗺️ Mappe la méthode de paiement WordPress → Task paymentMethod
function mapPaymentMethod(paymentMethod) {
  const method = (paymentMethod || '').toLowerCase().trim();

  if (!method || method === '') {
    return 'cash';
  }

  if (method.includes('bank') || method.includes('transfer')) {
    return 'BankTransfer';
  }

  if (method.includes('link') || method.includes('payment_link')) {
    return 'payment_link';
  }

  if (method.includes('paypal') || method.includes('visa') || method.includes('mastercard') || 
      method.includes('amex') || method.includes('card') || method.includes('stripe')) {
    return 'online';
  }

  if (method.includes('partial')) {
    return 'partial_payment';
  }

  return 'cash'; // Default
}

// 🗺️ Mappe le time slot → Task available
function mapAvailable(orderNotes) {
  const notes = (orderNotes || '').toLowerCase();

  if (notes.includes('7am') || notes.includes('12pm') || notes.includes('morning') || 
      notes.includes('between 7') || notes.includes('before 12')) {
    return '7am-12pm';
  }

  if (notes.includes('12pm') || notes.includes('5pm') || notes.includes('afternoon') || 
      notes.includes('between 2-5') || notes.includes('2-5pm') || notes.includes('after 12')) {
    return '12pm-5pm';
  }

  return 'AnyTime'; // Default
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
            // Informations de base (obligatoires)
            const firstName = (row['First Name (Billing)'] || '').trim();
            const lastName = (row['Last Name (Billing)'] || '').trim();
            const phoneNumber = (row['Phone (Billing)'] || '').trim();
            const postcode = (row['Postcode (Billing)'] || '').trim();
            const totalPrice = Number(row['Order Total Amount'] || 0) || 0;
            
            // Date de commande
            const dateStr = row['Order Date'] || new Date().toISOString();
            let date = new Date();
            try {
              // Format: "2025-12-24 00:22"
              if (dateStr.includes(' ')) {
                const [datePart, timePart] = dateStr.split(' ');
                const [year, month, day] = datePart.split('-');
                const [hour, minute] = (timePart || '00:00').split(':');
                date = new Date(year, month - 1, day, hour || 0, minute || 0);
              } else {
                date = new Date(dateStr);
              }
            } catch (e) {
              console.warn(
                `⚠️ Date invalide pour order ${orderNumber}: ${dateStr}, utilisation de la date actuelle`,
              );
            }

            // Adresses
            const billingAddress = (row['Address 1&2 (Billing)'] || '').trim();
            const collectionAddress = (row['Address 1&2 (Shipping)'] || '').trim();

            // Informations supplémentaires
            const bussinessName = (row['Company (Billing)'] || '').trim();
            const email = (row['Email (Billing)'] || '').trim();

            // Statuts et méthodes de paiement
            const orderStatus = row['Order Status'] || '';
            const paymentMethodRaw = row['Payment Method Title'] || '';

            // Time slot / Available
            const customerNote = (row['Customer Note'] || '').trim();

            ordersMap.set(orderNumber, {
              orderNumber,
              firstName: firstName || 'N/A',
              lastName: lastName || 'N/A',
              phoneNumber: phoneNumber || 'N/A',
              phoneNumber2: undefined, // Pas dans ce CSV
              postcode: postcode || 'N/A',
              email: email || undefined,
              billingAddress: billingAddress || undefined,
              collectionAddress: collectionAddress || undefined,
              bussinessName: bussinessName || undefined,
              totalPrice,
              date,
              orderStatus,
              paymentMethodRaw,
              customerNote,
              location: undefined, // Pas de coordonnées GPS dans ce CSV
              items: [],
            });
          }

          const order = ordersMap.get(orderNumber);

          // Ajoute l'item seulement s'il a un nom
          const itemName = (row['Item Name'] || '').trim();
          if (itemName) {
            order.items.push({
              itemName,
              quantity: Number(row['Quantity (- Refund)'] || 1) || 1,
              itemCost: Number(row['Item Cost'] || 0) || 0,
              sku: (row['SKU'] || '').trim(),
              Objectsposition: undefined, // Pas dans ce CSV, sera détecté automatiquement
            });
          }
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
async function migrateFromCsv(csvFilePath, dryRun = false, verbose = false) {
  console.log('🚀 Début migration depuis CSV:', csvFilePath);
  if (dryRun) {
    console.log('🧪 MODE DRY-RUN: Aucun enregistrement ne sera créé');
  }

  const orders = await loadOrdersFromCsv(csvFilePath);
  let successCount = 0;
  let skipCount = 0;
  let standardItemCount = 0;
  let customItemCount = 0;
  const customItems = new Set();

  for (const order of orders) {
    const resolvedItems = [];

    for (const oldItem of order.items) {
      const resolvedItem = await resolveItem(oldItem, verbose);
      if (resolvedItem) {
        resolvedItems.push(resolvedItem);
        
        // Compte les standard vs custom items
        if (resolvedItem.standardItemId) {
          standardItemCount++;
        } else {
          customItemCount++;
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
      const standardInOrder = resolvedItems.filter(i => i.standardItemId).length;
      const customInOrder = resolvedItems.filter(i => !i.standardItemId).length;
      console.log(
        `🧪 [DRY-RUN] Order ${order.orderNumber}: ${resolvedItems.length} items (${standardInOrder} standard, ${customInOrder} custom)`,
      );
      successCount++;
      continue;
    }

    try {
      // Mappe les statuts
      const paymentStatus = mapPaymentStatus(order.orderStatus);
      const paymentMethod = mapPaymentMethod(order.paymentMethodRaw);
      const available = mapAvailable(order.customerNote);

      // Détermine taskStatus selon orderStatus
      let taskStatus = 'New';
      if (order.orderStatus && order.orderStatus.toLowerCase().includes('completed')) {
        taskStatus = 'Completed';
      } else if (order.orderStatus && order.orderStatus.toLowerCase().includes('on hold')) {
        taskStatus = 'On_Hold';
      }

      // Construit l'objet Task avec tous les attributs
      const taskData = {
        // Champs obligatoires
        firstName: order.firstName,
        lastName: order.lastName,
        phoneNumber: order.phoneNumber,
        postcode: order.postcode,
        totalPrice: order.totalPrice || 0,
        date: order.date || new Date(),
        items: resolvedItems,

        // Champs optionnels de base
        ...(order.email && { email: order.email }),
        ...(order.billingAddress && { billingAddress: order.billingAddress }),
        ...(order.collectionAddress && { collectionAddress: order.collectionAddress }),
        ...(order.bussinessName && { bussinessName: order.bussinessName }),
        ...(order.phoneNumber2 && { phoneNumber2: order.phoneNumber2 }),
        ...(order.location && { location: order.location }),

        // Notes
        ...(order.customerNote && { additionalNotes: order.customerNote }),

        // Statuts et méthodes
        paymentStatus,
        paymentMethod,
        available,
        taskStatus,
        createdByType: 'Admin',
        createdBy: 'MigrationScript',

        // Par défaut, pas de photos (clientObjectPhotos est required mais empty array OK via middleware)
        clientObjectPhotos: [],
      };

      const task = new Task(taskData);
      await task.save();
      
      const standardInTask = resolvedItems.filter(i => i.standardItemId).length;
      const customInTask = resolvedItems.filter(i => !i.standardItemId).length;
      
      console.log(
        `✅ Order ${order.orderNumber} → Task ${task.orderNumber} (${resolvedItems.length} items: ${standardInTask} standard, ${customInTask} custom) | ${paymentStatus} | ${paymentMethod}`,
      );
      successCount++;
    } catch (error) {
      console.error(
        `❌ Erreur création Task pour order ${order.orderNumber}:`,
        error.message,
      );
      if (error.stack && verbose) {
        console.error(error.stack);
      }
      skipCount++;
    }
  }

  console.log('\n🎉 Migration terminée');
  console.log(`✅ ${successCount} commandes migrées`);
  if (skipCount > 0) {
    console.log(`⚠️ ${skipCount} commandes ignorées`);
  }
  
  // 📊 Statistiques détaillées sur les items
  console.log(`\n📊 Statistiques des items:`);
  console.log(`   ✅ ${standardItemCount} items standard (matchés avec StandardItem)`);
  console.log(`   📦 ${customItemCount} items custom (non trouvés dans StandardItem)`);
  
  if (customItems.size > 0) {
    console.log(`\n📦 Liste des ${customItems.size} items custom (non matchés):`);
    Array.from(customItems)
      .sort()
      .slice(0, 30)
      .forEach(item => console.log(`   - "${item}"`));
    if (customItems.size > 30) {
      console.log(`   ... et ${customItems.size - 30} autres`);
    }
    console.log(`\n💡 Astuce: Ces items pourraient être ajoutés à StandardItem si fréquents`);
  }

  if (!dryRun) {
    process.exit(0);
  }
}

// --- CLI entrypoint ---
// Usage:
//   node scripts/migrateCsvOrders.js path/to/file.csv
//   node scripts/migrateCsvOrders.js path/to/file.csv --dry-run
//   node scripts/migrateCsvOrders.js path/to/file.csv --verbose
const csvArg = process.argv[2];
const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--dry');
const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

if (!csvArg) {
  console.error(
    '❌ Usage: node scripts/migrateCsvOrders.js path/to/orders.csv [--dry-run] [--verbose]',
  );
  process.exit(1);
}

const csvPath = path.resolve(csvArg);
if (!fs.existsSync(csvPath)) {
  console.error('❌ Fichier CSV introuvable:', csvPath);
  process.exit(1);
}

migrateFromCsv(csvPath, dryRun, verbose).catch(err => {
  console.error('❌ Migration error:', err);
  process.exit(1);
});


