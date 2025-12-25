const paginateQuery = async (
    Model,
    queryParams,
    filterFields = [],
    searchFields = []
) => {
    const {
        page = 1,
        limit = 1000,
        keyword,
        sort = '-createdAt',
    } = queryParams;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const queryFilter = {};

    if (keyword && searchFields.length > 0) {
        // Check if both firstName and lastName are in searchFields and keyword contains a space (full name search)
        const hasFirstName = searchFields.includes('firstName');
        const hasLastName = searchFields.includes('lastName');
        const keywordParts = keyword.trim().split(/\s+/);

        if (hasFirstName && hasLastName && keywordParts.length >= 2) {
            // Full name search: match firstName + lastName combination
            // Support both "John Doe" (firstName=John, lastName=Doe) and "Doe John" (firstName=Doe, lastName=John)
            const orConditions = searchFields
                .filter(field => field !== 'firstName' && field !== 'lastName')
                .map((field) => ({
                    [field]: { $regex: keyword, $options: 'i' },
                }));

            // Add full name combinations
            orConditions.push(
                {
                    $and: [
                        { firstName: { $regex: keywordParts[0], $options: 'i' } },
                        { lastName: { $regex: keywordParts.slice(1).join(' '), $options: 'i' } }
                    ]
                },
                {
                    $and: [
                        { firstName: { $regex: keywordParts.slice(1).join(' '), $options: 'i' } },
                        { lastName: { $regex: keywordParts[0], $options: 'i' } }
                    ]
                }
            );

            queryFilter.$or = orConditions;
        } else {
            // Regular search across all fields
            queryFilter.$or = searchFields.map((field) => ({
                [field]: { $regex: keyword, $options: 'i' },
            }));
        }
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
