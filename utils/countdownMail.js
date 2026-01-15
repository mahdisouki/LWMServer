const axios = require("axios");

const COUNTDOWNMAIL_API_KEY = process.env.COUNTDOWNMAIL_API_KEY || 'rAuwgO8DAHXikWI23A6-l-fyZ_YwrNQW';

async function createCountdownTimer({
  name,
  expiresAt,
  timezone = "Europe/London"
}) {
  try {
    if (!COUNTDOWNMAIL_API_KEY) {
      throw new Error('COUNTDOWNMAIL_API_KEY is not set in environment variables');
    }

    const response = await axios.post(
      "https://countdownmail.com/api/create",
      {
        skin_id: 3,
        name,
        time_end: expiresAt,
        time_zone: timezone,
        font_family: "Roboto-Bold",
        color_primary: "28C152",
        color_text: "000000",
        color_bg: "FFFFFF",
        font_size: 30,
        labels: 1,
        days: "days",
        hours: "hours",
        minutes: "minutes",
        seconds: "seconds",
        expired_mes_on: 1,
        expired_mes: "Offer expired"
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": COUNTDOWNMAIL_API_KEY
        }
      }
    );

    const data = response.data;

    if (data.status !== "success") {
      throw new Error(`CountdownMail timer creation failed: ${data.message || 'Unknown error'}`);
    }

    return data.message; // { id, code, src }
  } catch (error) {
    console.log('error', error);
    console.error('Error creating CountdownMail timer:', error.message || error);
    throw error;
  }
}

module.exports = { createCountdownTimer };
