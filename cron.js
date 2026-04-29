const cron = require("node-cron");
const { runForAllTerritories } = require("./incentiveService");

cron.schedule(
  "0 5 15 27 4 *",
  async () => {
    console.log("Running monthly incentive cron job...");
    await runForAllTerritories();
  },
  {
    timezone: "Asia/Kolkata"
  }
);