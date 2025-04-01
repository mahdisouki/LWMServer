const paginateQuery = async (
    Model,
    queryParams,
    filterFields = [],
    searchFields = []
) => {
    const {
        page = 1,
        limit = 10,
        keyword,
        sort = '-createdAt',
    } = queryParams;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const queryFilter = {};

    if (keyword && searchFields.length > 0) {
        queryFilter.$or = searchFields.map((field) => ({
            [field]: { $regex: keyword, $options: 'i' },
        }));
    }

    for (const field of filterFields) {
        const value = queryParams[field];
        if (value !== undefined && value !== '') {
            const parsedDate = new Date(value);
            const isDate = !isNaN(parsedDate.getTime());

            if (isDate) {
                const nextDay = new Date(parsedDate);
                nextDay.setDate(nextDay.getDate() + 1);

                queryFilter[field] = {
                    $gte: parsedDate.toISOString(),
                    $lt: nextDay.toISOString(),
                };
            } else {
                queryFilter[field] = value;
            }
        }
    }

    const [total, data] = await Promise.all([
        Model.countDocuments(queryFilter),
        Model.find(queryFilter).sort(sort).skip(skip).limit(limitNum),
    ]);

    return {
        data,
        meta: {
            currentPage: pageNum,
            limit: limitNum,
            total,
            count: data.length,
        },
    };
};

module.exports = paginateQuery;
