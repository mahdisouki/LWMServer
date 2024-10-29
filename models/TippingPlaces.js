const mongoose = require('mongoose');
const { Schema } = mongoose;

const TippingPlaceSchema = new Schema({
    tippingName:{

    },
    address:{

    },
    location:{

    },
    daysClosed:{

    },
    operatingHours:{

    },
    itemsAllowed:{

    },
    itemNotAllowed:{

    },
    pricePerTon:{

    },
    minWeightToCharge:{

    },



}, { timestamps: true });

const TippingPlace = mongoose.model('tippingPlace', TippingPlaceSchema);
module.exports = TippingPlace;

