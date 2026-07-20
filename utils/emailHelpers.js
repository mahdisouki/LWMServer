// Helper function to check if staging mode is enabled
const isStaging = () => {
  return process.env.STAGING === 'true' || process.env.STAGING === '1';
};

// Helper function to add staging indicator to subject
const addStagingToSubject = (subject) => {
  if (isStaging()) {
    return `[STAGING/TEST MODE] ${subject}`;
  }
  return subject;
};

// Helper function to add staging banner to HTML content
const addStagingBanner = (html) => {
  if (!isStaging()) {
    return html;
  }
  
  const stagingBanner = `
    <div style="background-color: #ff9800; color: white; padding: 15px; text-align: center; font-weight: bold; margin-bottom: 20px; border-radius: 5px;">
      ⚠️ STAGING/TEST MODE - This is a test email from the staging environment ⚠️
    </div>
  `;
  
  // Insert banner at the beginning of the HTML body
  if (html && typeof html === 'string') {
    if (html.includes('<body')) {
      return html.replace('<body', `${stagingBanner}<body`);
    } else if (html.includes('<div')) {
      return `${stagingBanner}${html}`;
    } else {
      return `${stagingBanner}<div>${html}</div>`;
    }
  }
  
  return html;
};

function isBankTransferPayment(task) {
  return (
    task?.paymentMethod === 'BankTransfer' ||
    task?.paidAmount?.method === 'BankTransfer' ||
    task?.remainingAmount?.method === 'BankTransfer'
  );
}

function buildBankTransferDetailsHtml(orderNumber) {
  return `
          <div class="bank-details-section">
            <div class="bank-details-header">
              <span>🏦 Bank Details:</span>
            </div>
            <div class="bank-details-content">
              <div class="value"><strong>Business Account Name:</strong> London Waste Management</div>
              <div class="value"><strong>Sort Code:</strong> 30-96-26</div>
              <div class="value"><strong>Account Number:</strong> 55867268</div>
              <div class="value"><strong>Reference:</strong> ${orderNumber}</div>
            </div>
          </div>`;
}

module.exports = {
  isStaging,
  addStagingToSubject,
  addStagingBanner,
  isBankTransferPayment,
  buildBankTransferDetailsHtml,
};
