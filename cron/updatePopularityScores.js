const cron = require('node-cron');

const {

  updatePopularityScores,

  isPopularityStale,

} = require('../services/popularityService');



const POPULARITY_CRON_TIMEZONE =

  process.env.POPULARITY_CRON_TIMEZONE || 'Europe/London';



async function runPopularityUpdate(reason = 'scheduled') {

  try {

    const result = await updatePopularityScores();

    console.log(

      `[Popularity Cron] ${reason}: updated ${result.itemsUpdated} item(s), ` +

        `${result.categoriesUpdated} categor(ies) ` +

        `(${result.itemsWithSales} items with sales)`,

    );

    return result;

  } catch (error) {

    console.error(`[Popularity Cron] ${reason} failed:`, error);

    throw error;

  }

}



// 1st day of every month at 4:00 AM

cron.schedule('0 4 1 * *', () => runPopularityUpdate('monthly'), {

  timezone: POPULARITY_CRON_TIMEZONE,

});



// Populate or refresh on startup when data is missing or stale

setImmediate(async () => {

  try {

    const stale = await isPopularityStale();

    if (stale) {

      await runPopularityUpdate('startup');

    } else {

      console.log('[Popularity Cron] Scores are fresh — skipping startup run');

    }

  } catch (error) {

    console.error('[Popularity Cron] Startup check failed:', error);

  }

});



console.log(

  `[Popularity Cron] Scheduler running — monthly on the 1st at 04:00 ${POPULARITY_CRON_TIMEZONE}`,

);



module.exports = { runPopularityUpdate };

