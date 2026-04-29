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

const QUARTER_MONTHS = 3;

// Feb, May, Aug, Nov = quarter-end months for Growth
const QUARTER_END_MONTHS = ['02', '05', '08', '11'];

function getGrowthRow(baseLakhs) {
  return GROWTH_TABLE.find(r => baseLakhs >= r.min && baseLakhs <= r.max) || null;
}

function calculateGrowthIncentive(baseNum, totalSales) {
  const baseLakhs = baseNum / 100000;
  const growthRow = getGrowthRow(baseLakhs);
  if (!growthRow) return null;

  let lastReached = -1;
  for (let i = 0; i < GROWTH_COLS.length; i++) {
    const target = QUARTER_MONTHS * GROWTH_COLS[i].multiplier * baseNum;
    if (totalSales >= target) lastReached = i;
  }

  if (lastReached < 0) return null;
  return growthRow.incentives[GROWTH_COLS[lastReached].key];
}

function getPreviousMonth() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getCurrentMonthMM() {
  return String(new Date().getMonth() + 1).padStart(2, '0');
}

// ── Growth logic for quarter-end months (Feb, May, Aug, Nov) ─────────────────
async function handleGrowthQuarterEnd(territory, base, period) {
  // Fetch PCPM
  const [pcpmRows] = await pool.query(
    "SELECT updated_pcpm FROM pcpm WHERE Territory=? LIMIT 1",
    [territory]
  );
  if (pcpmRows.length === 0) {
    console.log(`${territory}: No PCPM found, skipping.`);
    return;
  }
  const pcpm = parseFloat(pcpmRows[0].updated_pcpm);

  // Fetch recent sales (previous month)
  const prevMonth = getPreviousMonth();
  const [recentSalesRows] = await pool.query(
    "SELECT Sales FROM secondary_sales WHERE Territory=? AND Period=? LIMIT 1",
    [territory, prevMonth]
  );
  if (recentSalesRows.length === 0) {
    console.log(`${territory}: No recent sales for ${prevMonth}, skipping.`);
    return;
  }
  const recentSales = parseFloat(recentSalesRows[0].Sales);

  // Step 1: Set eligibility based on recent sales vs PCPM
  if (recentSales < pcpm) {
    await pool.query(
      "UPDATE incentiveeligibility SET eligibility=0 WHERE Territory=?",
      [territory]
    );
    console.log(`${territory}: Eligibility = 0 (recentSales ₹${recentSales} < PCPM ₹${pcpm})`);
  } else {
    await pool.query(
      "UPDATE incentiveeligibility SET eligibility=1 WHERE Territory=?",
      [territory]
    );
    console.log(`${territory}: Eligibility = 1 (recentSales ₹${recentSales} >= PCPM ₹${pcpm})`);
  }

  // Step 2: Sum all sales and upsert into totalsales
  const [totalSalesRows] = await pool.query(
    "SELECT SUM(Sales) AS total FROM secondary_sales WHERE Territory=?",
    [territory]
  );
  const totalSales = parseFloat(totalSalesRows[0].total) || 0;

  const [existsRows] = await pool.query(
    "SELECT Territory FROM totalsales WHERE Territory=? LIMIT 1",
    [territory]
  );
  if (existsRows.length > 0) {
    await pool.query(
      "UPDATE totalsales SET yearly_sales=? WHERE Territory=?",
      [totalSales, territory]
    );
  } else {
    await pool.query(
      "INSERT INTO totalsales (Territory, yearly_sales) VALUES (?, ?)",
      [territory, totalSales]
    );
  }
  console.log(`${territory}: yearly_sales updated to ₹${totalSales}`);

  // Step 3: Save incentive only if eligible
  const [eligRows] = await pool.query(
    "SELECT eligibility FROM incentiveeligibility WHERE Territory=? LIMIT 1",
    [territory]
  );
  const isEligible = eligRows.length > 0 && eligRows[0].eligibility === 1;

  if (isEligible) {
    const incentive = calculateGrowthIncentive(base, totalSales);
    if (incentive) {
      await pool.query(
        `INSERT INTO incentives (Incentive, Territory, Period) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE Incentive=VALUES(Incentive)`,
        [incentive, territory, period]
      );
      console.log(`${territory}: Growth incentive saved ₹${incentive}`);
    } else {
      console.log(`${territory}: Eligible but no milestone reached.`);
    }
  } else {
    console.log(`${territory}: Not eligible, incentive skipped.`);
  }
}

// ── Growth logic for non-quarter months (all other months) ───────────────────
async function handleGrowthNonQuarter(territory) {
  // Just keep yearly_sales running total updated
  const [totalSalesRows] = await pool.query(
    "SELECT SUM(Sales) AS total FROM secondary_sales WHERE Territory=?",
    [territory]
  );
  const totalSales = parseFloat(totalSalesRows[0].total) || 0;

  const [existsRows] = await pool.query(
    "SELECT Territory FROM totalsales WHERE Territory=? LIMIT 1",
    [territory]
  );
  if (existsRows.length > 0) {
    await pool.query(
      "UPDATE totalsales SET yearly_sales=? WHERE Territory=?",
      [totalSales, territory]
    );
  } else {
    await pool.query(
      "INSERT INTO totalsales (Territory, yearly_sales) VALUES (?, ?)",
      [territory, totalSales]
    );
  }
  console.log(`${territory}: Non-quarter month — yearly_sales updated to ₹${totalSales}`);

  // ── Add future month-specific Growth logic here ───────────────────────────
  // Example:
  // if (currentMonthMM === '03') { await handleGrowthMarch(territory); }
  // if (currentMonthMM === '06') { await handleGrowthJune(territory);  }
}

// ── Main function ─────────────────────────────────────────────────────────────
async function calculateIncentiveForTerritory(territory) {
  try {
    const currentMonthMM = getCurrentMonthMM();
    const period         = new Date().toISOString().slice(0, 7); // YYYY-MM

    const [rankRows] = await pool.query(
      "SELECT Base, Category FROM Rankings WHERE Territory=? LIMIT 1",
      [territory]
    );
    if (rankRows.length === 0) return;

    const base     = parseFloat(rankRows[0].Base);
    const category = rankRows[0].Category;

    // ── Tier 2 — runs every month ─────────────────────────────────────────────
    if (category === "Tier_2") {
      const [salesRows] = await pool.query(
        "SELECT Sales FROM monthly_sales_summary WHERE Territory=? LIMIT 1",
        [territory]
      );
      if (salesRows.length === 0) return;

      const salary = parseFloat(salesRows[0].Sales);
      const growth = salary - base;

      if (growth >= 40000 && salary >= 100000 && salary < 160000) {
        await pool.query("UPDATE Rankings SET Category=?, Base=? WHERE Territory=?", ["Tier_1", salary, territory]);
        await pool.query("INSERT INTO incentives (Incentive, Territory, Period) VALUES (?, ?, ?)", [15000, territory, period]);
        console.log(`${territory}: Tier_2 → Tier_1, incentive ₹15000`);

      } else if (growth >= 40000 && salary >= 160000) {
        await pool.query("UPDATE Rankings SET Category=?, Base=? WHERE Territory=?", ["Growth", salary, territory]);
        await pool.query("INSERT INTO incentives (Incentive, Territory, Period) VALUES (?, ?, ?)", [15000, territory, period]);
        console.log(`${territory}: Tier_2 → Growth, incentive ₹15000`);

      } else {
        console.log(`${territory}: Tier_2 — no incentive condition met.`);
      }

    // ── Tier 1 — runs every month ─────────────────────────────────────────────
    } else if (category === "Tier_1") {
      const [salesRows] = await pool.query(
        "SELECT Sales FROM monthly_sales_summary WHERE Territory=? LIMIT 1",
        [territory]
      );
      if (salesRows.length === 0) return;

      const salary = parseFloat(salesRows[0].Sales);
      const growth = salary - base;

      if (growth >= 50000 && base >= 160000) {
        await pool.query("UPDATE Rankings SET Category=?, Base=? WHERE Territory=?", ["Growth", salary, territory]);
        await pool.query("INSERT INTO incentives (Incentive, Territory, Period) VALUES (?, ?, ?)", [20000, territory, period]);
        console.log(`${territory}: Tier_1 → Growth, incentive ₹20000`);

      } else if (growth >= 50000 && base < 160000) {
        await pool.query("UPDATE Rankings SET Category=?, Base=? WHERE Territory=?", ["Tier_1", salary, territory]);
        await pool.query("INSERT INTO incentives (Incentive, Territory, Period) VALUES (?, ?, ?)", [20000, territory, period]);
        console.log(`${territory}: Tier_1 stays Tier_1, incentive ₹20000`);

      } else {
        console.log(`${territory}: Tier_1 — no incentive condition met.`);
      }

    // ── Growth — runs every month but logic differs by month ──────────────────
    } else if (category === "Growth") {
      if (QUARTER_END_MONTHS.includes(currentMonthMM)) {
        // Feb, May, Aug, Nov — full quarter-end logic
        await handleGrowthQuarterEnd(territory, base, period);
      } else {
        // All other months — non-quarter logic
        // Add more month-specific handlers here in future
        await handleGrowthNonQuarter(territory);
      }
    }

    console.log(`${territory} processed.`);

  } catch (err) {
    console.log(`Error in ${territory}:`, err.message);
  }
}

// ── Run for all territories every month ───────────────────────────────────────
async function runForAllTerritories() {
  try {
    console.log(`Running incentive calculation — ${new Date().toISOString()}`);
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