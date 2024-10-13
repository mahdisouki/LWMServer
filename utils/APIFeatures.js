class APIfeatures {
  constructor(query, queryString) {
    this.query = query;
    this.queryString = queryString;
    this.total = 0;
  }

  async filtering() {
    const queryObj = { ...this.queryString };
    const excludedFields = ["page", "sort", "limit"];
    excludedFields.forEach((el) => delete queryObj[el]);

    let queryStr = JSON.stringify(queryObj);
    queryStr = queryStr.replace(
      /\b(gte|gt|lt|lte|regex)\b/g,
      (match) => "$" + match
    );

    // Filtering
    let countQuery = this.query.clone();
    this.query = this.query.find(JSON.parse(queryStr));
    countQuery = countQuery.find(JSON.parse(queryStr));

    // Count total documents for pagination
    this.total = await countQuery.countDocuments();

    return this; // Return 'this' for method chaining
  }

  sorting() {
    if (this.queryString.sort) {
      const sortBy = this.queryString.sort.split(",").join(" ");
      this.query = this.query.sort(sortBy);
    } else {
      this.query = this.query.sort("-createdAt");
    }

    return this; // Return 'this' for method chaining
  }

  paginating() {
    const page = parseInt(this.queryString.page, 10) || 1;
    const limit = parseInt(this.queryString.limit, 10) || 9;
    const skip = (page - 1) * limit;
    this.query = this.query.skip(skip).limit(limit);

    return this; // Return 'this' for method chaining
  }
}

module.exports = APIfeatures;
