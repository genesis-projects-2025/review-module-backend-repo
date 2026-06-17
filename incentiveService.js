const pool = require("./dataBaseConnection");

const GROWTH_TABLE = [
  { min: 1.6,  max: 2.5,      incentives: { 20: 15000,  30: 22500,  40: 30000,  50: 45000,  100: 60000,  150: 75000  } },
  { min: 2.51, max: 3.5,      incentives: { 20: 22500,  30: 37500,  40: 52500,  50: 75000,  100: 105000, 150: 120000 } },
  { min: 3.51, max: 5,        incentives: { 20: 45000,  30: 67500,  40: 90000,  50: 120000, 100: 150000, 150: 180000 } },
  { min: 5.01, max: 7,        incentives: { 20: 60000,  30: 90000,  40: 120000, 50: 150000, 100: 180000, 150: 210000 } },
  { min: 7.01, max: Infinity, incentives: { 20: 90000,  30: 120000, 40: 150000, 50: 180000, 100: 210000, 150: 240000 } },
];

const GROWTH_COLS = [
  { key: 20,  multiplier: 1.2 },
  { key: 30,  multiplier: 1.3 },
  { key: 40,  multiplier: 1.4 },
  { key: 50,  multiplier: 1.5 },
  { key: 100, multiplier: 2.0 },
  { key: 150, multiplier: 2.5 },
];

// Aug=08, Nov=11, Feb=02  => incentive calculation months
const GROWTH_INCENTIVE_MONTHS = ['02', '08', '11'];

function getGrowthRow(baseLakhs) {
  return GROWTH_TABLE.find(r => baseLakhs >= r.min && baseLakhs <= r.max) || null;
}

function calculateGrowthIncentiveByAvg(baseNum, avgSales) {
  const baseLakhs = baseNum / 100000;
  const growthRow = getGrowthRow(baseLakhs);
  if (!growthRow) return null;

  const growthPct = ((avgSales - baseNum) / baseNum) * 100;

  let lastReached = -1;
  for (let i = 0; i < GROWTH_COLS.length; i++) {
    if (growthPct >= GROWTH_COLS[i].key) lastReached = i;
  }

  if (lastReached < 0) return null;
  return growthRow.incentives[GROWTH_COLS[lastReached].key];
}

function getCurrentMonthMM() {
  return String(new Date().getMonth() + 1).padStart(2, '0');
}

// Helper: add current month's sales to yearly_sales
async function addSalesToYearlySales(territory, sales) {
  const [rows] = await pool.query(
    "SELECT total_sales FROM yearly_sales WHERE Territory=? LIMIT 1",
    [territory]
  );

  if (rows.length > 0) {
    const newTotal = (parseFloat(rows[0].total_sales) || 0) + sales;
    await pool.query(
      "UPDATE yearly_sales SET total_sales=? WHERE Territory=?",
      [newTotal, territory]
    );
    console.log(`${territory}: yearly_sales updated to Rs.${newTotal}`);
  } else {
    await pool.query(
      "INSERT INTO yearly_sales (Territory, total_sales) VALUES (?, ?)",
      [territory, sales]
    );
    console.log(`${territory}: New yearly_sales row inserted Rs.${sales}`);
  }
}

// Growth: remaining months (not Aug/Nov/Feb)
async function handleGrowthRegularMonth(territory, sales, prevsales, incentivequalification) {

  if (incentivequalification === 0) {

    if (sales >= prevsales) {
      await addSalesToYearlySales(territory, sales);

    } else {
      await pool.query(
        "UPDATE Eligibility SET Incentivequalification=? WHERE Territory=?",
        [-1, territory]
      );
      console.log(`${territory}: sales < prevsales -- Incentivequalification set to -1`);
      await addSalesToYearlySales(territory, sales);
    }

  } else {
    // incentivequalification !== 0 => just accumulate sales
    await addSalesToYearlySales(territory, sales);
  }
}

// Growth: Aug, Nov, Feb
async function handleGrowthIncentiveMonth(territory, base, period, sales, prevsales, incentivequalification) {

  if (incentivequalification === 0 && sales >= prevsales) {

    const [avgRows] = await pool.query(
      "SELECT AVG(total_sales) AS avg_total FROM yearly_sales WHERE Territory=?",
      [territory]
    );
    const avgSales = parseFloat(avgRows[0].avg_total) || 0;

    const incentive = calculateGrowthIncentiveByAvg(base, avgSales);

    if (incentive) {
      await pool.query(
        `INSERT INTO incentives (Incentive, Territory, Period) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE Incentive=VALUES(Incentive)`,
        [incentive, territory, period]
      );
      console.log(`${territory}: Growth incentive Rs.${incentive} saved for period ${period}`);
    } else {
      console.log(`${territory}: Eligible but avg growth did not reach any milestone (min 20% required).`);
    }

    await addSalesToYearlySales(territory, sales);

  } else {
    await addSalesToYearlySales(territory, sales);
  }

  // Final eligibility update based on sales vs base
  if (sales > base) {
    await pool.query(
      "UPDATE Eligibility SET Incentivequalification=? WHERE Territory=?",
      [0, territory]
    );
    console.log(`${territory}: sales > base -- Incentivequalification reset to 0`);
  } else {
    await pool.query(
      "UPDATE Eligibility SET Incentivequalification=? WHERE Territory=?",
      [-1, territory]
    );
    console.log(`${territory}: sales <= base -- Incentivequalification set to -1`);
  }
}

// Growth router
async function handleGrowth(territory, base, period) {
  const currentMonthMM = getCurrentMonthMM();

  const [salesRows] = await pool.query(
    "SELECT Sales, PrevSales FROM CompareSales WHERE Territory=? LIMIT 1",
    [territory]
  );
  if (salesRows.length === 0) {
    console.log(`${territory}: No sales data found in CompareSales, skipping.`);
    return;
  }
  const sales     = parseFloat(salesRows[0].Sales);
  const prevsales = parseFloat(salesRows[0].PrevSales);

  const [eligRows] = await pool.query(
    "SELECT Incentivequalification FROM Eligibility WHERE Territory=? LIMIT 1",
    [territory]
  );
  if (eligRows.length === 0) {
    console.log(`${territory}: No eligibility row found, skipping.`);
    return;
  }
  const incentivequalification = parseInt(eligRows[0].Incentivequalification);

  if (GROWTH_INCENTIVE_MONTHS.includes(currentMonthMM)) {
    console.log(`${territory}: Growth -- incentive month (${currentMonthMM})`);
    await handleGrowthIncentiveMonth(territory, base, period, sales, prevsales, incentivequalification);
  } else {
    console.log(`${territory}: Growth -- regular month (${currentMonthMM})`);
    await handleGrowthRegularMonth(territory, sales, prevsales, incentivequalification);
  }
}


async function calculateIncentiveForTerritory(territory) {
  try {
    const period = new Date().toISOString().slice(0, 7);

    const [rankRows] = await pool.query(
      "SELECT Base, Category FROM Rankings WHERE Territory=? LIMIT 1",
      [territory]
    );

    if (rankRows.length === 0) return;

    const base     = parseFloat(rankRows[0].Base);
    const category = rankRows[0].Category;

    if (category === "Growth") {
      await handleGrowth(territory, base, period);
      return;
    }

    const [eligibilityRows] = await pool.query(
      `SELECT Incentivequalification, Incentive, Tier
       FROM Eligibility
       WHERE Territory=? LIMIT 1`,
      [territory]
    );

    if (eligibilityRows.length === 0) return;

    const incentivequalification = parseInt(eligibilityRows[0].Incentivequalification);
    const incentive              = parseFloat(eligibilityRows[0].Incentive || 0);
    const tier                   = eligibilityRows[0].Tier;

    const [salesRows] = await pool.query(
      `SELECT Sales, PrevSales
       FROM CompareSales
       WHERE Territory=? LIMIT 1`,
      [territory]
    );

    if (salesRows.length === 0) return;

    const sales     = parseFloat(salesRows[0].Sales);
    const prevsales = parseFloat(salesRows[0].PrevSales);
    // WHEN INCENTIVEQUALIFICATION = 1
    if (incentivequalification === 1) {
      await addSalesToYearlySales(territory, sales)

      if (sales >= prevsales) {

        await pool.query(
          `INSERT INTO incentives (Incentive, Territory, Period)
           VALUES (?, ?, ?)`,
          [incentive, territory, period]
        );

        await pool.query(
          `UPDATE Rankings
           SET Category=?, Base=?
           WHERE Territory=?`,
          [tier, prevsales, territory]
        );

        console.log(
          `${territory}: Incentive Rs.${incentive} credited. Category updated to ${tier}`
        );

        if (tier !== "Growth") {

          if ((sales - prevsales >= 50000) && sales >= 160000) {

            await pool.query(
              `UPDATE Eligibility
               SET Incentivequalification=?,
                   Incentive=?,
                   Tier=?
               WHERE Territory=?`,
              [1, 20000, "Growth", territory]
            );

            console.log(`${territory}: Eligible for Growth incentive Rs.20000`);

          } else {

            await pool.query(
              `UPDATE Eligibility
               SET Incentivequalification=?,
                   Incentive=?
               WHERE Territory=?`,
              [0, 0, territory]
            );

            console.log(`${territory}: Eligibility reset`);
          }

        } else {

          await pool.query(
            `UPDATE Eligibility
             SET Incentivequalification=?,
                 Incentive=?
             WHERE Territory=?`,
            [0, 0, territory]
          );

          console.log(`${territory}: Growth achieved. Eligibility reset`);
        }

      } else {
        await pool.query(
          `UPDATE Eligibility
           SET Incentivequalification=?,
               Incentive=?
           WHERE Territory=?`,
          [0, 0, territory]
        );
        console.log(`${territory}: Sales not greater than PrevSales`);
      }

    }

    // WHEN INCENTIVEQUALIFICATION = 0
    else if (incentivequalification === 0) {
      await addSalesToYearlySales(territory, sales)

      if (category === "Tier-II") {

        const growth = sales - base;

        if (growth >= 40000 && sales > 100000 && sales <= 160000) {

          await pool.query(
            `UPDATE Eligibility
             SET Incentivequalification=?,
                 Incentive=?,
                 Tier=?
             WHERE Territory=?`,
            [1, 15000, "Tier-I", territory]
          );

          console.log(`${territory}: Eligible for Tier-I incentive Rs.15000`);

        } else if (growth >= 40000 && sales > 160000) {

          await pool.query(
            `UPDATE Eligibility
             SET Incentivequalification=?,
                 Incentive=?,
                 Tier=?
             WHERE Territory=?`,
            [1, 35000, "Growth", territory]
          );

          console.log(`${territory}: Eligible for Growth incentive Rs.35000`);

        } else {
          console.log(`${territory}: Tier-II conditions not met`);
        }
      }

      else if (category === "Tier-I") {

        const growth = sales - base;

        if (growth >= 50000 && sales > 160000) {

          await pool.query(
            `UPDATE Eligibility
             SET Incentivequalification=?,
                 Incentive=?,
                 Tier=?
             WHERE Territory=?`,
            [1, 20000, "Growth", territory]
          );

          console.log(`${territory}: Eligible for Growth incentive Rs.20000`);

        } else {
          console.log(`${territory}: Tier-I conditions not met`);
        }
      }
    }

    console.log(`${territory} processed.`);

  } catch (err) {
    console.log(`Error in ${territory}:`, err.message);
  }
}

// Run for all territories every month
async function runForAllTerritories() {
  try {
    console.log(`Running incentive calculation -- ${new Date().toISOString()}`);
    const [rows] = await pool.query("SELECT Territory FROM Rankings");
    for (const row of rows) {
      await calculateIncentiveForTerritory(row.Territory);
    }
    console.log("All territories processed.");
  } catch (err) {
    console.log("Error in runForAllTerritories:", err.message);
  }
}

module.exports = {
  calculateIncentiveForTerritory,
  runForAllTerritories,
};
