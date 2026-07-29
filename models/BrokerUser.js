const mongoose = require('mongoose');
const { User } = require('./User');

const brokerUserSchema = new mongoose.Schema({
  brokerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BrokerOrg',
    required: true,
  },
});

const BrokerUser = User.discriminator('Broker', brokerUserSchema);

module.exports = BrokerUser;
