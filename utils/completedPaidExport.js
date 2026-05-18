const PDFDocument = require('pdfkit');
const { buildCsvRow } = require('./csvFormat');

function buildCompletedPaidQuery(rangeStart, rangeEndExclusive) {
  return {
    taskStatus: 'Completed',
    parentTaskId: null,
    date: { $gte: rangeStart, $lt: rangeEndExclusive },
    $or: [
      { paymentStatus: 'Paid' },
      {
        paymentStatus: 'partial_Paid',
        'paidAmount.status': 'Paid',
        'remainingAmount.status': 'Paid',
      },
    ],
  };
}

function buildCompletedPaidCsv(tasks) {
  const lines = [
    buildCsvRow(['Postcode', 'Price', 'Order Number']),
    ...tasks.map((t) => buildCsvRow([t.postcode, t.totalPrice, t.orderNumber])),
  ];
  return lines.join('\n');
}

function buildCompletedPaidPdfBuffer(tasks, { startDate, endDate }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageBottom = 750;
    const cols = { postcode: 50, price: 200, orderNumber: 300 };
    const rowHeight = 16;

    const drawTableHeader = (y) => {
      doc.font('Helvetica-Bold').fontSize(10);
      doc.text('Postcode', cols.postcode, y);
      doc.text('Price', cols.price, y);
      doc.text('Order Number', cols.orderNumber, y);
      const lineY = y + 14;
      doc.moveTo(50, lineY).lineTo(545, lineY).stroke();
      return lineY + 6;
    };

    doc.fontSize(16).text('Completed Paid Orders', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Collection dates: ${startDate} to ${endDate}`, { align: 'center' });
    doc.text(`Total orders: ${tasks.length}`, { align: 'center' });
    doc.moveDown(1.5);

    let y = drawTableHeader(doc.y);
    doc.font('Helvetica').fontSize(9);

    for (const task of tasks) {
      if (y > pageBottom) {
        doc.addPage();
        y = drawTableHeader(50);
        doc.font('Helvetica').fontSize(9);
      }
      const price =
        task.totalPrice != null
          ? `£${Number(task.totalPrice).toFixed(2)}`
          : '';
      doc.text(String(task.postcode ?? ''), cols.postcode, y, {
        width: 140,
        lineBreak: false,
      });
      doc.text(price, cols.price, y, { width: 90, lineBreak: false });
      doc.text(String(task.orderNumber ?? ''), cols.orderNumber, y, {
        width: 220,
        lineBreak: false,
      });
      y += rowHeight;
    }

    doc.end();
  });
}

module.exports = {
  buildCompletedPaidQuery,
  buildCompletedPaidCsv,
  buildCompletedPaidPdfBuffer,
};
