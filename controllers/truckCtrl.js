const Task = require("../models/Task");
const Truck = require("../models/Truck");

class APIfeatures {
    constructor(query , queryString){
        this.query=query;
        this.queryString= queryString;
    }
    filtering(){
       const queryObj = {...this.queryString} //queryString = req.query
       const exludedFileds = ['page', 'sort' , 'limit']
       exludedFileds.forEach(el => delete(queryObj[el]))
       let queryStr = JSON.stringify(queryObj)
       queryStr = queryStr.replace(/\b(gte|gt|lt|lte|regex)\b/g , match => '$' + match)
       this.query.find(JSON.parse(queryStr))
        return this ;
    }
    sorting(){
        if(this.queryString.sort){
            const sortBy = this.queryString.sort.split(',').join(' ')
            console.log(sortBy)
            this.query = this.query.sort(sortBy)
        }else{
            this.query = this.query.sort('-createdAt')
        }
        return this ; 
    }
    paginating(){ 
        const page = this.queryString.page * 1 || 1
        const limit = this.queryString.limit * 1 || 9
        const skip = (page-1) * limit
        this.query = this.query.skip(skip).limit(limit )
         return this ; 
    }
}
const truckCtrl = {
createTruck: async (req, res) => {
    try {
        const { name ,loadCapacity ,matricule} = req.body;
        const newTruck = new Truck({ name ,loadCapacity,matricule});
        await newTruck.save();
        res.status(201).json({ message: "Truck created successfully", truck: newTruck });
    } catch (error) {
        res.status(500).json({ message: "Failed to create truck", error: error.message });
    }
},
getAllTrucks: async (req, res) => {
    try {
        const trucks = await Truck.find();
        res.status(200).json({ trucks });
    } catch (error) {
        res.status(500).json({ message: "Failed to retrieve trucks", error: error.message });
    }
},
deleteTruck: async (req, res) => {
    const { id } = req.params;
    try {
        const truck = await Truck.findByIdAndDelete(id);
        if (!truck) {
            return res.status(404).json({ message: "Truck not found" });
        }
        res.status(200).json({ message: "Truck deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Failed to delete truck", error: error.message });
    }
},

};

module.exports = truckCtrl;
