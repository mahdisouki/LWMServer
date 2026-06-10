const { pollNewMessages } = require('./gmailService');

const { enrichNewMessagesWithAiCategory } = require('./emailClassifierService');



/** Poll Gmail history and classify new INBOX threads via Python (port 8001). */

async function pollNewMessagesWithClassification(adminId) {

  const result = await pollNewMessages(adminId);

  if (result.newMessages?.length) {

    result.newMessages = await enrichNewMessagesWithAiCategory(

      adminId,

      result.newMessages

    );

  }

  return result;

}



module.exports = { pollNewMessagesWithClassification };

