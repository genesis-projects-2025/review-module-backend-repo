
require('dotenv').config(); // only for local dev; Render/Railway/Vercel use env vars
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
require("./cron"); // starts cron job automatically

const {
  calculateIncentiveForTerritory,
  runForAllTerritories
} = require("./incentiveService");





// ---------- Helper: computeAggregates ----------
// ---------- Hierarchy Route (Fixed) ----------
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000' ;
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
// const allowedOrigins = [
//   'http://localhost:3000',
//   'http://127.0.0.1:3000',
//   process.env.FRONTEND_ORIGIN // optional: for production
// ].filter(Boolean);

// app.use(cors({
//   origin: allowedOrigins,
//   credentials: true
// }));
app.use(express.json());

// ---------- DB pool (imported from shared module) ----------
const pool = require("./dataBaseConnection");


// ---------- Health check ----------
app.get('/healthz', (_, res) => res.send('ok'));


// ---------- Helper: computeAggregates ----------
// ---------- Hierarchy Route (Fixed) ----------
// GET one Emp_Name by Territory

app.post("/CalculateIncentive", async (req, res) => {
  try {
    const { territory } = req.body;

    await calculateIncentiveForTerritory(territory);

    res.json({ message: "Processed successfully" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/run-monthly-job", async (req, res) => {
  await runForAllTerritories();
  res.send("All territories processed manually");
});




app.post("/hierarchy", async (req, res) => {
  try {
    const { territory, includeInactive, Month } = req.body || {};
    let rows = [];

    let query = "SELECT * FROM hierarchy_metrics_agg_rm WHERE 1=1";
    let params = [];

    if (includeInactive !== true) {
      query += " AND Emp_Code != 'Vacant'";
    }

    if (Month) {
      query += " AND Period = ?";
      params.push(Month);
    }

    [rows] = await pool.query(query, params);

    if (!rows.length) return res.json({ message: "No data found" });

    const byTerritory = {};
    rows.forEach((r) => (byTerritory[r.Territory] = r));

    const avg = (arr) =>
      arr.length ? arr.reduce((a, b) => a + (b || 0), 0) / arr.length : 0;

    const sum = (arr) =>
      arr.length ? arr.reduce((a, b) => a + (b || 0), 0) : 0;

    function buildNode(terr) {
      const emp = byTerritory[terr];
      if (!emp) return null;

      const childRows = rows.filter(
        (r) => r.Area_Name && r.Area_Name.trim() === emp.Territory.trim()
      );

      const children = {};
      for (const c of childRows) {
        const childNode = buildNode(c.Territory);
        if (childNode) children[c.Territory] = childNode;
      }

      let node = {
        empName: emp.Emp_Name,
        territory: emp.Territory,
        role: emp.Role,
        children,

        Coverage: emp.Coverage ? parseFloat(emp.Coverage) : 0,
        Calls: emp.Calls ? parseFloat(emp.Calls) : 0,
        Compliance: emp.Compliance ? parseFloat(emp.Compliance) : 0,
        Chemist_Calls: emp.Chemist_Calls ? parseFloat(emp.Chemist_Calls) : 0,

        // PRODUCT QTY FIELDS
        Deksel_Midmonth_Qty: emp.Deksel_Midmonth_Qty
          ? parseFloat(emp.Deksel_Midmonth_Qty)
          : 0,
        Voltaneuron_Midmonth_Qty: emp.Voltaneuron_Midmonth_Qty
          ? parseFloat(emp.Voltaneuron_Midmonth_Qty)
          : 0,
        Proaxen_Midmonth_Qty: emp.Proaxen_Midmonth_Qty
          ? parseFloat(emp.Proaxen_Midmonth_Qty)
          : 0,

        // COMMITMENT FIELDS
        Deksel_Commitment: emp.Deksel_Commitment
          ? parseFloat(emp.Deksel_Commitment)
          : 0,
        Proaxen_Commitment: emp.Proaxen_Commitment
          ? parseFloat(emp.Proaxen_Commitment)
          : 0,
        Voltaneuron_Vasoneuron_Commitment: emp.Voltaneuron_Vasoneuron_Commitment
          ? parseFloat(emp.Voltaneuron_Vasoneuron_Commitment)
          : 0,

        // 🔥 NEW PRESCRIBER FIELDS
        Active_Prescribers: emp.Active_Prescribers
          ? parseFloat(emp.Active_Prescribers)
          : 0,
        Passive_Prescribers: emp.Passive_Prescribers
          ? parseFloat(emp.Passive_Prescribers)
          : 0,
        Active_Prescribers_Gain: emp.Active_Prescribers_Gain
          ? parseFloat(emp.Active_Prescribers_Gain)
          : 0,
        Active_Prescribers_Lost: emp.Active_Prescribers_Lost
          ? parseFloat(emp.Active_Prescribers_Lost)
          : 0,
      };

      if (Object.keys(children).length > 0) {
        const agg = {
          Coverage: [],
          Calls: [],
          Compliance: [],
          Chemist_Calls: [],

          // PRODUCT QTY ARRAYS
          Deksel_Midmonth_Qty: [],
          Voltaneuron_Midmonth_Qty: [],
          Proaxen_Midmonth_Qty: [],

          // COMMITMENT ARRAYS
          Deksel_Commitment: [],
          Proaxen_Commitment: [],
          Voltaneuron_Vasoneuron_Commitment: [],

          // 🔥 NEW PRESCRIBER ARRAYS
          Active_Prescribers: [],
          Passive_Prescribers: [],
          Active_Prescribers_Gain: [],
          Active_Prescribers_Lost: [],
        };

        for (const ch of Object.values(children)) {
          agg.Coverage.push(ch.Coverage || 0);
          agg.Calls.push(ch.Calls || 0);
          agg.Compliance.push(ch.Compliance || 0);
          agg.Chemist_Calls.push(ch.Chemist_Calls || 0);

          // PRODUCT QTY PUSH
          agg.Deksel_Midmonth_Qty.push(ch.Deksel_Midmonth_Qty || 0);
          agg.Voltaneuron_Midmonth_Qty.push(ch.Voltaneuron_Midmonth_Qty || 0);
          agg.Proaxen_Midmonth_Qty.push(ch.Proaxen_Midmonth_Qty || 0);

          // COMMITMENT PUSH
          agg.Deksel_Commitment.push(ch.Deksel_Commitment || 0);
          agg.Proaxen_Commitment.push(ch.Proaxen_Commitment || 0);
          agg.Voltaneuron_Vasoneuron_Commitment.push(ch.Voltaneuron_Vasoneuron_Commitment || 0);

          // 🔥 NEW PRESCRIBER PUSH
          agg.Active_Prescribers.push(ch.Active_Prescribers || 0);
          agg.Passive_Prescribers.push(ch.Passive_Prescribers || 0);
          agg.Active_Prescribers_Gain.push(ch.Active_Prescribers_Gain || 0);
          agg.Active_Prescribers_Lost.push(ch.Active_Prescribers_Lost || 0);
        }

        // AVG non-sales fields
        node.Coverage = Math.round(avg(agg.Coverage));
        node.Calls = Math.round(avg(agg.Calls));
        node.Compliance = Math.round(avg(agg.Compliance));
        node.Chemist_Calls = Math.round(avg(agg.Chemist_Calls));

        // SUM product qty fields
        node.Deksel_Midmonth_Qty = Math.round(sum(agg.Deksel_Midmonth_Qty));
        node.Voltaneuron_Midmonth_Qty = Math.round(sum(agg.Voltaneuron_Midmonth_Qty));
        node.Proaxen_Midmonth_Qty = Math.round(sum(agg.Proaxen_Midmonth_Qty));

        // SUM commitment fields
        node.Deksel_Commitment = Math.round(sum(agg.Deksel_Commitment));
        node.Proaxen_Commitment = Math.round(sum(agg.Proaxen_Commitment));
        node.Voltaneuron_Vasoneuron_Commitment = Math.round(sum(agg.Voltaneuron_Vasoneuron_Commitment));

        // 🔥 SUM prescriber fields
        node.Active_Prescribers = Math.round(sum(agg.Active_Prescribers));
        node.Passive_Prescribers = Math.round(sum(agg.Passive_Prescribers));
        node.Active_Prescribers_Gain = Math.round(sum(agg.Active_Prescribers_Gain));
        node.Active_Prescribers_Lost = Math.round(sum(agg.Active_Prescribers_Lost));
      }

      return node;
    }

    const allTerritories = rows.map((r) => r.Territory);
    const topLevels = rows.filter(
      (r) => !allTerritories.includes(r.Area_Name)
    );

    const hierarchy = {};
    if (territory) {
      const node = buildNode(territory);
      if (node) hierarchy[territory] = node;
    } else {
      for (const top of topLevels) {
        const node = buildNode(top.Territory);
        if (node) hierarchy[top.Territory] = node;
      }
    }

    res.json(hierarchy);
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).send("Server error: " + err.message);
  }
});

app.post("/hierarchy1", async (req, res) => {
  try {
    let { territory, period, division, product, focus } = req.body || {};

    if (!period) {
      return res.status(400).json({ error: "Period (YYYY-MM) is required" });
    }

    const [rows] = await pool.query(
      "SELECT Territory, Area_Name, Emp_Name, Division, Role, period, metrics FROM hierarchy_metrics_tgt_vs_sales WHERE period = ?",
      [period]
    );

    if (!rows.length) {
      return res.json({ message: "No data found for selected period" });
    }

    // Parse metrics JSON safely
    for (const r of rows) {
      try {
        r.metrics =
          typeof r.metrics === "string"
            ? JSON.parse(r.metrics)
            : r.metrics || [];
      } catch {
        r.metrics = [];
      }

      // ⭐ Apply focus filter at the metrics level immediately after parsing
      if (focus && focus !== "") {
        r.metrics = r.metrics.filter(
          m => m.Focus && m.Focus.trim().toLowerCase() === focus.trim().toLowerCase()
        );
      }
    }

    // -------------------------------------------------------------
    // ⭐ HELPER: Aggregate metrics arrays by Product_Name
    // -------------------------------------------------------------
    function aggregateMetrics(metricArrays) {
      const map = {};

      for (const arr of metricArrays) {
        for (const item of arr) {
          const key = item.Product_Name;
          if (!map[key]) {
            map[key] = {
              Product_Name: key,
              Focus: item.Focus,
              Sales_value: 0,
              Secondary_units: 0,
              Target_Qty: 0,
              Target_Value: 0,
              Sales_YTD: 0,       // ⭐ NEW
              Target_YTD: 0,      // ⭐ NEW
              _hasTarget: false,
              _hasTargetYTD: false, // ⭐ NEW
            };
          }

          map[key].Sales_value += parseFloat(item.Sales_value) || 0;
          map[key].Secondary_units += parseInt(item.Secondary_units) || 0;
          map[key].Target_Qty += parseFloat(item.Target_Qty) || 0;
          map[key].Target_Value += parseFloat(item.Target_Value) || 0;
          map[key].Sales_YTD += parseFloat(item.Sales_YTD) || 0;    // ⭐ NEW
          map[key].Target_YTD += parseFloat(item.Target_YTD) || 0;  // ⭐ NEW

          if (item.Target_Value && parseFloat(item.Target_Value) > 0) {
            map[key]._hasTarget = true;
          }
          if (item.Target_YTD && parseFloat(item.Target_YTD) > 0) {  // ⭐ NEW
            map[key]._hasTargetYTD = true;
          }
        }
      }

      return Object.values(map).map(p => {
        const achieved =
          p._hasTarget && p.Target_Value > 0
            ? parseFloat(((p.Sales_value / p.Target_Value) * 100).toFixed(2))
            : null;

        const achievedYTD =                                           // ⭐ NEW
          p._hasTargetYTD && p.Target_YTD > 0
            ? parseFloat(((p.Sales_YTD / p.Target_YTD) * 100).toFixed(2))
            : null;

        return {
          Product_Name: p.Product_Name,
          Focus: p.Focus,
          Sales_value: parseFloat(p.Sales_value.toFixed(2)),
          Secondary_units: p.Secondary_units,
          Target_Qty: parseFloat(p.Target_Qty.toFixed(2)),
          Target_Value: parseFloat(p.Target_Value.toFixed(2)),
          Target_Achieved_Percent: achieved,
          Sales_YTD: parseFloat(p.Sales_YTD.toFixed(2)),              // ⭐ NEW
          Target_YTD: parseFloat(p.Target_YTD.toFixed(2)),            // ⭐ NEW
          YTD_Achieved_Percent: achievedYTD,                          // ⭐ NEW
        };
      });
    }

    // -------------------------------------------------------------
    // ⭐ HELPER: Filter metrics by product
    // -------------------------------------------------------------
    function filterMetrics(metrics) {
      if (!product) {
        return aggregateMetrics([metrics]);
      }
      return metrics.filter(m => m.Product_Name === product);
    }

    // -------------------------------------------------------------
    // ⭐ STEP 1: FIND FULL SUBTREE
    // -------------------------------------------------------------
    function getAllDescendants(startTerritory) {
      const result = new Set();
      const queue = [startTerritory];

      while (queue.length > 0) {
        const terr = queue.shift();
        result.add(terr);
        const children = rows.filter(
          r =>
            r.Area_Name &&
            r.Area_Name.trim().toLowerCase() === terr.trim().toLowerCase()
        );
        children.forEach(ch => queue.push(ch.Territory));
      }

      return result;
    }

    const subtreeTerritories = territory
      ? getAllDescendants(territory)
      : new Set(rows.map(r => r.Territory));

    // -------------------------------------------------------------
    // ⭐ STEP 2: Collect all BE-level divisions for UI
    // -------------------------------------------------------------
    let divisionsUnderUser = new Set();

    rows.forEach(r => {
      if (!subtreeTerritories.has(r.Territory)) return;

      const hasChild = rows.some(
        x =>
          x.Area_Name &&
          x.Area_Name.trim().toLowerCase() === r.Territory.trim().toLowerCase()
      );

      if (!hasChild && r.Division) {
        divisionsUnderUser.add(r.Division.trim());
      }
    });

    // -------------------------------------------------------------
    // ⭐ STEP 3: BE-LEVEL FILTER BASED ON DIVISION
    // -------------------------------------------------------------
    let filteredRows = rows.filter(r => {
      if (!subtreeTerritories.has(r.Territory)) return false;

      const hasChild = rows.some(
        x =>
          x.Area_Name &&
          x.Area_Name.trim().toLowerCase() === r.Territory.trim().toLowerCase()
      );

      if (!hasChild && division) {
        return r.Division && r.Division.trim() === division.trim();
      }

      return true;
    });

    // -------------------------------------------------------------
    // ⭐ STEP 4: REMOVE EMPTY PARENTS
    // (also prune BEs that have zero metrics after focus filter)
    // -------------------------------------------------------------
    function hasValidSubtree(terr) {
      const r = filteredRows.find(x => x.Territory === terr);
      if (!r) return false;

      const isBE = !rows.some(
        x =>
          x.Area_Name &&
          x.Area_Name.trim().toLowerCase() === r.Territory.trim().toLowerCase()
      );

      if (isBE) {
        // ⭐ If focus filtered and no metrics remain, prune this BE
        return r.metrics.length > 0;
      }

      const children = filteredRows.filter(
        x =>
          x.Area_Name &&
          x.Area_Name.trim().toLowerCase() === terr.trim().toLowerCase()
      );

      return children.some(c => hasValidSubtree(c.Territory));
    }

    filteredRows = filteredRows.filter(r => hasValidSubtree(r.Territory));

    // -------------------------------------------------------------
    // ⭐ STEP 5: BUILD LOOKUP
    // -------------------------------------------------------------
    const byTerritory = {};
    filteredRows.forEach(r => (byTerritory[r.Territory] = r));

    // -------------------------------------------------------------
    // ⭐ STEP 6: BUILD NODE RECURSIVELY WITH METRICS ROLLUP
    // -------------------------------------------------------------
    function buildNode(terr) {
      const emp = byTerritory[terr];
      if (!emp) return null;

      const childRows = filteredRows.filter(
        r =>
          r.Area_Name &&
          r.Area_Name.trim().toLowerCase() === terr.trim().toLowerCase()
      );

      const children = {};
      for (const c of childRows) {
        const childNode = buildNode(c.Territory);
        if (childNode) children[c.Territory] = childNode;
      }

      let metrics;

      if (Object.keys(children).length === 0) {
        // BE level — metrics already focus-filtered, apply product filter
        metrics = filterMetrics(emp.metrics);
      } else {
        // Parent level — aggregate children metrics (already focus-filtered)
        const childMetricArrays = Object.values(children).map(ch => ch.metrics);
        const aggregated = aggregateMetrics(childMetricArrays);

        metrics = product
          ? aggregated.filter(m => m.Product_Name === product)
          : aggregated;
      }

      return {
        empName: emp.Emp_Name,
        territory: emp.Territory,
        role: emp.Role,
        period: emp.period,
        metrics,
        children,
      };
    }

    // -------------------------------------------------------------
    // ⭐ STEP 7: FIND TOP NODES
    // -------------------------------------------------------------
    const childAreas = new Set(
      filteredRows.map(r => r.Area_Name && r.Area_Name.trim()).filter(Boolean)
    );

    const topLevels = filteredRows.filter(
      r => !childAreas.has(r.Territory.trim())
    );

    // -------------------------------------------------------------
    // ⭐ STEP 8: FINAL HIERARCHY
    // -------------------------------------------------------------
    const hierarchy = {};

    if (territory) {
      const node = buildNode(territory);
      if (node) hierarchy[territory] = node;
    } else {
      for (const top of topLevels) {
        const node = buildNode(top.Territory);
        if (node) hierarchy[top.Territory] = node;
      }
    }

    // -------------------------------------------------------------
    // ⭐ STEP 9: Collect unique product names (after focus filter)
    // -------------------------------------------------------------
    const allProducts = new Set();
    filteredRows.forEach(r => {
      if (Array.isArray(r.metrics)) {
        r.metrics.forEach(m => allProducts.add(m.Product_Name));
      }
    });

    return res.json({
      hierarchy,
      divisions: Array.from(divisionsUnderUser),
      products: Array.from(allProducts).sort(),
    });

  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).send("Server error: " + err.message);
  }
});






// ---------- Employees ----------
app.get('/employees', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT Emp_Name AS name, Role, Emp_Code, Territory 
      FROM organogram
      ORDER BY Emp_Name
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error /employees:', err);
    res.status(500).send("Error");
  }
});

app.put('/updateProductQty', async (req, res) => {
  try {
    const { territory, metric_type, value, Month } = req.body;

    if (!territory || !metric_type || value === undefined) {
      return res.status(400).json({
        error: "territory, metric_type, and value are required"
      });
    }

    // Validate metric_type
    const allowedMetrics = [
      'deksel_midmonth_qty',
      'voltaneuron_midmonth_qty',
      'proaxen_midmonth_qty',

      // 🔥 newly added commitment metrics
      'deksel_commitment',
      'proaxen_commitment',
      'voltaneuron_vasoneuron_commitment'
    ];


    if (!allowedMetrics.includes(metric_type.toLowerCase())) {
      return res.status(400).json({
        error: "Invalid metric_type"
      });
    }

    // Check current value
    let query = `SELECT ${metric_type} FROM hierarchy_metrics_agg_rm WHERE Territory = ?`;
    let params = [territory];

    if (Month) {
      query += ` AND Period = ?`;
      params.push(Month);
    }

    const [currentRows] = await pool.query(query, params);

    if (currentRows.length > 0 && currentRows[0][metric_type] === value) {
      return res.json({ alreadyUpToDate: true });
    }

    // Update the value
    let updateQuery = `UPDATE hierarchy_metrics_agg_rm SET ${metric_type} = ? WHERE Territory = ?`;
    let updateParams = [value, territory];

    if (Month) {
      updateQuery += ` AND Period = ?`;
      updateParams.push(Month);
    }

    const [result] = await pool.query(updateQuery, updateParams);

    res.json({
      success: true,
      affectedRows: result.affectedRows,
      alreadyUpToDate: false
    });

  } catch (err) {
    console.error("Error /updateProductQty:", err);
    res.status(500).json({ error: "Server Error: " + err.message });
  }
});


app.post('/midmonth-review', async (req, res) => {
  try {
    const { sender_territory, receiver_territory, Metric, Value, created_at } = req.body;

    // Validate required fields
    if (!sender_territory || !receiver_territory || !Metric || Value === undefined) {
      return res.status(400).json({
        error: "All fields are required: sender_territory, receiver_territory, Metric, Value"
      });
    }

    // Generate IST timestamp
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC + 5:30
    const istTime = new Date(Date.now() + istOffset);
    const timestamp = created_at || istTime.toISOString().slice(0, 19).replace('T', ' ');

    // Insert into Midmonth_review_logs table
    const [result] = await pool.query(
      `INSERT INTO Midmonth_review_logs 
       (sender_territory, receiver_territory, Metric, Value, created_at) 
       VALUES (?, ?, ?, ?, ?)`,
      [sender_territory, receiver_territory, Metric, Value, timestamp]
    );

    // Return success response
    res.status(201).json({
      success: true,
      message: "Record inserted successfully",
      insertId: result.insertId,
      timestamp: timestamp
    });

  } catch (err) {
    console.error("Error /midmonth-review:", err);
    res.status(500).json({
      error: "Server Error",
      details: err.message
    });
  }
});



app.get('/checkrole', async (req, res) => {
  try {
    const { territory } = req.query;

    if (!territory) {
      return res.status(400).json({ error: "Territory is required" });
    }

    const [rows] = await pool.query(
      `SELECT Role,Emp_Name FROM organogram WHERE Territory = ? LIMIT 1`,
      [territory]
    );

    if (rows.length === 0) {
      return res.json({ allowed: false, message: "Territory not found" });
    }

    const role = rows[0].Role?.toUpperCase(); // Handle case variations
    const allowedRoles = ['BE', 'KAE', 'TE', 'NE'];
    const isAllowed = allowedRoles.includes(role);

    res.json({
      allowed: isAllowed,
      role: rows[0].Role,
      name: rows[0].Emp_Name // Return actual role for debugging
    });

  } catch (err) {
    console.error("Error in /checkrole:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get('/getdivision', async (req, res) => {
  try {
    const { territory, role } = req.query;
    if (!territory) {
      return res.status(400).json({ error: "territory is required" });
    }

    let query = "";
    let params = [territory];

    if (role === 'BH') {
      query = `SELECT DISTINCT division FROM bgm_bh_dashboard_ftm WHERE BH_Territory = ?`;
    } else if (role === 'SBUH') {
      query = `SELECT DISTINCT division FROM bgm_sbuh_dashboard_ftm WHERE SBUH_Territory = ?`;
    } else {
      query = `SELECT Division FROM organogram WHERE Territory = ? LIMIT 1`;
    }

    const [rows] = await pool.query(query, params);

    if (role === 'BH' || role === 'SBUH') {
      const divisions = rows.map(r => r.division).filter(Boolean);
      res.json({ divisions, division: divisions[0] || null });
    } else {
      // For other roles, return a single division as before for backward compatibility
      const division = rows.length > 0 ? (rows[0].Division || rows[0].division) : null;
      res.json({ division });
    }

  } catch (err) {
    console.error("Error /getdivision:", err);
    res.status(500).send("Server Error");
  }
});

app.get('/emp-name/:territory', async (req, res) => {
  const territory = req.params.territory;

  try {
    const [rows] = await pool.query(
      "SELECT Emp_Name FROM organogram WHERE Territory = ? LIMIT 1",
      [territory]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "No employee found for given Territory" });
    }

    res.json({ Emp_Name: rows[0].Emp_Name });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
app.post('/getBase', async (req, res) => {

  try {
     const { territory } = req.body;
    const [rows] = await pool.query(
      "SELECT * FROM Rankings WHERE Territory = ? LIMIT 1",
      [territory]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "No employee found for given Territory" });
    }

    res.json({ Base: rows[0].Base,Category: rows[0].Category,FixedBase: rows[0].FixedBase });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
app.post('/getYearlySales', async (req, res) => {
  try {
    const { territory } = req.body;

    const [rows] = await pool.query(
      "SELECT total_sales AS totalsales FROM yearly_sales WHERE Territory = ?",
      [territory]
    );

    res.json({
      sales: rows[0].totalsales || 0
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
app.post('/getSales', async (req, res) => {
  try {
    const { territory } = req.body;

    const [rows] = await pool.query(
      "SELECT Territory,sales,period FROM totalsales WHERE Territory = ?",
      [territory]
    );

    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
app.post('/isEligible', async (req, res) => {
  try {
    const { territory } = req.body;

    const [rows] = await pool.query(
      "SELECT Incentivequalification FROM Eligibility WHERE Territory = ?",
      [territory]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        message: "Territory not found"
      });
    }

    res.json(rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
app.post('/getIncentives', async (req, res) => {
  try {
    const { territory } = req.body;

    const [rows] = await pool.query(
      "SELECT Territory,incentive,period FROM incentives WHERE Territory = ?",
      [territory]
    );

    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

//   try {
//     const { territory } = req.body;

//     if (!territory) {
//       return res.status(400).json({ error: "Territory is required" });
//     }

//     // Step 1: Get Base & Category
//     const [rankRows] = await pool.query(
//       "SELECT Base, Category FROM Rankings WHERE Territory = ? LIMIT 1",
//       [territory]
//     );

//     if (rankRows.length === 0) {
//       return res.status(404).json({ message: "No data found in Rankings" });
//     }

//     const base = rankRows[0].Base;
//     const category = rankRows[0].Category;

//     // Step 2: Get Sales
//     const [salesRows] = await pool.query(
//       "SELECT Sales FROM monthly_sales_summary WHERE Territory = ? LIMIT 1",
//       [territory]
//     );

//     if (salesRows.length === 0) {
//       return res.status(404).json({ message: "No sales data found" });
//     }

//     const salary = salesRows[0].Sales;
//     const growth = salary - base;
// console.log(base,category,salary,growth);
//     const period = "2026-03"; // ⚠️ keep as string

//     // Helper
//    const addIncentiveTier = async (incentive, newTier) => {
//   try {
//     console.log("Updating Rankings...");
//     await pool.query(
//       "UPDATE Rankings SET Category = ?, Base = ? WHERE Territory = ?",
//       [newTier, salary, territory]
//     );

//     console.log("Inserting into Incentives...");
//     const result = await pool.query(
//       "INSERT INTO incentives (Incentive, Territory, Period) VALUES (?, ?, ?)",
//       [incentive, territory, period]
//     );

//     console.log("Insert Result:", result);

//   } catch (err) {
//     console.error("Error inside addIncentiveTier:", err.message);
//     throw err; // important
//   }
// };

//     // Step 3: Logic
//     if (category === 'Tier_2') {

//       if (growth >= 40000 && salary >= 100000 && salary < 160000) {
//         await addIncentiveTier(15000, 'Tier_1');

//       } else if (growth >= 40000 && salary >= 160000) {
//         await addIncentiveTier(15000, 'Growth');
//       }

//     } 
//     else if (category === 'Tier_1') {

//       if (growth >= 50000 && base >= 160000) {
//         await addIncentiveTier(20000, 'Growth');

//       } else if (growth >= 50000 && base < 160000) {
//         await addIncentiveTier(20000, 'Tier_1');
//       }
//     }

//     res.json({
//       message: "Incentive processed successfully",
//       Base: base,
//       Category: category,
//       Salary: salary,
//       Growth: growth
//     });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Server error" });
//   }
// });

app.post('/putData', async (req, res) => {
  try {
    const dataToInsert = req.body;
    const dataArray = Array.isArray(dataToInsert) ? dataToInsert : [dataToInsert];

    if (dataArray.length === 0) {
      return res.status(400).send('No data received');
    }

    const values = dataArray.map(row => [
      row.metric,
      row.sender,
      row.sender_code,
      row.sender_territory,
      row.receiver,
      row.receiver_code,
      row.receiver_territory,
      row.goal,
      row.received_date,
      row.goal_date,
      row.receiver_commit_date || null,
      row.commitment
    ]);

    const query = `
      INSERT INTO commitments (
        metric,
        sender,
        sender_code,
        sender_territory,
        receiver,
        receiver_code,
        receiver_territory,
        goal,
        received_date,
        goal_date,
        receiver_commit_date,
        commitment
      ) VALUES ?
    `;

    await pool.query(query, [values]);
    return res.status(201).send('success');
  } catch (err) {
    console.error('Error /putData:', err);
    return res.status(500).send('Internal Server Error');
  }
});
app.post('/dashboardData', async (req, res) => {
  try {
    const { Territory, Month } = req.body; // 👈 Get Territory from frontend

    if (!Territory) {
      return res.status(400).json({ error: "Territory is required" });
    }

    let query = `SELECT * FROM bgm_be_dashboard_ftm WHERE Territory = ?`;
    let params = [Territory];

    if (Month) {
      query += ` AND Period = ?`;
      params.push(Month);
    }

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({ message: "No record found for this Territory" });
    }

    res.json(rows[0]); // 👈 Return only the first (and likely only) matching row
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post('/bmDashboardData', async (req, res) => {
  try {
    const { Territory, Month } = req.body; // 👈 Get Territory from frontend

    if (!Territory) {
      return res.status(400).json({ error: "Territory is required" });
    }

    let query = `SELECT * FROM bgm_bm_dashboard_ftm WHERE BM_Territory = ?`;
    let params = [Territory];

    if (Month) {
      query += ` AND Period = ?`;
      params.push(Month);
    }

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({ message: "No record found for this Territory" });
    }

    res.json(rows[0]); // 👈 Return only the first (and likely only) matching row
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
app.post('/blDashboardData', async (req, res) => {
  try {
    const { Territory, Month } = req.body; // 👈 Get Territory from frontend

    if (!Territory) {
      return res.status(400).json({ error: "Territory is required" });
    }

    let query = `SELECT * FROM bgm_bl_dashboard_ftm WHERE BL_Territory = ?`;
    let params = [Territory];

    if (Month) {
      query += ` AND Period = ?`;
      params.push(Month);
    }

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({ message: "No record found for this Territory" });
    }

    res.json(rows[0]); // 👈 Return only the first (and likely only) matching row
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post('/bhDashboardData', async (req, res) => {
  try {
    const { Territory, Division, Month } = req.body;

    if (!Territory) {
      return res.status(400).json({ error: "Territory is required" });
    }

    let tableName = "bgm_bh_dashboard_ftm";
    let divisionFilter = Division;

    // Handle special divisions
    if (Division === "Glamus_Gladius") {
      tableName = "bgm_bh_dashboard_glamus_ftm";
      divisionFilter = "GLADIUS";
    } else if (Division === "Glamus_Stimulus") {
      tableName = "bgm_bh_dashboard_glamus_ftm";
      divisionFilter = "STIMULUS";
    }
    let query = `SELECT * FROM ${tableName} WHERE BH_Territory = ?`;
    let params = [Territory];

    // Add division filter if provided
    if (divisionFilter) {
      query += ` AND division = ?`;
      params.push(divisionFilter);
    }

    // Add month filter if provided
    if (Month) {
      query += ` AND Period = ?`;
      params.push(Month);
    }

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({
        message: divisionFilter
          ? `No FTM record found for Territory: ${Territory}, Division: ${divisionFilter}`
          : `No FTM record found for Territory: ${Territory}`
      });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("Error fetching BH FTM data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// 4. SBUH Dashboard FTM Data (with Division filter)
app.post('/sbuhDashboardData', async (req, res) => {
  try {
    const { Territory, Division, Month } = req.body;

    if (!Territory) {
      return res.status(400).json({ error: "Territory is required" });
    }

    let query = `SELECT * FROM bgm_sbuh_dashboard_ftm WHERE SBUH_Territory = ?`;
    let params = [Territory];

    // Add division filter if provided
    if (Division) {
      query += ` AND division = ?`;
      params.push(Division);
    }

    if (Month) {
      query += ` AND Period = ?`;
      params.push(Month);
    }

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({
        message: Division
          ? `No SBUH FTM record found for Territory: ${Territory}, Division: ${Division}`
          : `No SBUH FTM record found for Territory: ${Territory}`
      });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("Error fetching SBUH FTM data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post('/dashboardytdData', async (req, res) => {
  try {
    const { Territory, Month } = req.body; // 👈 Get Territory from frontend

    if (!Territory) {
      return res.status(400).json({ error: "Territory is required" });
    }

    let query = `SELECT * FROM bgm_be_dashboard_ytd WHERE Territory = ?`;
    let params = [Territory];

    if (Month) {
      query += ` AND Period = ?`;
      params.push(Month);
    }

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({ message: "No record found for this Territory" });
    }

    res.json(rows[0]); // 👈 Return only the first (and likely only) matching row
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post('/bmDashboardytdData', async (req, res) => {
  try {
    const { Territory, Month } = req.body; // 👈 Get Territory from frontend

    if (!Territory) {
      return res.status(400).json({ error: "Territory is required" });
    }

    let query = `SELECT * FROM bgm_bm_dashboard_ytd WHERE BM_Territory = ?`;
    let params = [Territory];

    if (Month) {
      query += ` AND Period = ?`;
      params.push(Month);
    }

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({ message: "No record found for this Territory" });
    }

    res.json(rows[0]); // 👈 Return only the first (and likely only) matching row
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
app.post('/blDashboardytdData', async (req, res) => {
  try {
    const { Territory, Month } = req.body; // 👈 Get Territory from frontend

    if (!Territory) {
      return res.status(400).json({ error: "Territory is required" });
    }

    let query = `SELECT * FROM bgm_bl_dashboard_ytd WHERE BL_Territory = ?`;
    let params = [Territory];

    if (Month) {
      query += ` AND Period = ?`;
      params.push(Month);
    }

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({ message: "No record found for this Territory" });
    }

    res.json(rows[0]); // 👈 Return only the first (and likely only) matching row
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
app.post('/bhDashboardytdData', async (req, res) => {
  try {
    const { Territory, Division, Month } = req.body;

    if (!Territory) {
      return res.status(400).json({ error: "Territory is required" });
    }

    let tableName = "bgm_bh_dashboard_ytd";
    let divisionFilter = Division;

    // Handle special divisions
    if (Division === "Glamus_Gladius") {
      tableName = "bgm_bh_dashboard_glamus_ytd";
      divisionFilter = "GLADIUS";
    } else if (Division === "Glamus_Stimulus") {
      tableName = "bgm_bh_dashboard_glamus_ytd";
      divisionFilter = "STIMULUS";
    }

    let query = `SELECT * FROM ${tableName} WHERE BH_Territory = ?`;
    let params = [Territory];

    // Add division filter if provided
    if (divisionFilter) {
      query += ` AND division = ?`;
      params.push(divisionFilter);
    }

    // Add month filter if provided
    if (Month) {
      query += ` AND Period = ?`;
      params.push(Month);
    }

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({
        message: divisionFilter
          ? `No YTD record found for Territory: ${Territory}, Division: ${divisionFilter}`
          : `No YTD record found for Territory: ${Territory}`
      });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("Error fetching BH YTD data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// 2. SBUH Dashboard YTD Data (with Division filter)
app.post('/sbuhDashboardytdData', async (req, res) => {
  try {
    const { Territory, Division, Month } = req.body;

    if (!Territory) {
      return res.status(400).json({ error: "Territory is required" });
    }

    let query = `SELECT * FROM bgm_sbuh_dashboard_ytd WHERE SBUH_Territory = ?`;
    let params = [Territory];

    // Add division filter if provided
    if (Division) {
      query += ` AND division = ?`;
      params.push(Division);
    }

    if (Month) {
      query += ` AND Period = ?`;
      params.push(Month);
    }

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({
        message: Division
          ? `No SBUH YTD record found for Territory: ${Territory}, Division: ${Division}`
          : `No SBUH YTD record found for Territory: ${Territory}`
      });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("Error fetching SBUH YTD data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
app.post('/dashboardYTD', async (req, res) => {
  try {
    const { Territory, Month } = req.body;

    if (!Territory) {
      return res.status(400).json({ error: "Territory is required" });
    }

    let query = `SELECT 
         Calls_Score,
         RCPA_Score,
         Coverage_Score,
         Compliance_Score,
         Activity_Implementation_Score,
         Target_Achieved_Score,
         MSR_Achievement_Score,
         RX_Growth_Score,
         Brand_Performance_Index_Score
       FROM bgm_be_dashboard_ytd
       WHERE Territory = ?`;
    let params = [Territory];

    if (Month) {
      query += ` AND Period = ?`;
      params.push(Month);
    }

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({ message: "No record found for this Territory" });
    }

    const row = rows[0];

    // First set
    const totalScore1 = (
      (Number(row.Calls_Score) || 0) +
      (Number(row.RCPA_Score) || 0) +
      (Number(row.Coverage_Score) || 0) +
      (Number(row.Compliance_Score) || 0) +
      (Number(row.Activity_Implementation_Score) || 0)).toFixed(2);

    const totalScore2 = (
      (Number(row.Target_Achieved_Score) || 0) +
      (Number(row.MSR_Achievement_Score) || 0) +
      (Number(row.RX_Growth_Score) || 0) +
      (Number(row.Brand_Performance_Index_Score) || 0)).toFixed(2);


    res.json({
      totalScore1: Number(parseFloat(totalScore1).toFixed(2)),
      totalScore2: Number(parseFloat(totalScore2).toFixed(2))
    });

  } catch (error) {
    console.error("Error fetching YTD data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


app.post('/dashboardFTD', async (req, res) => {
  try {
    const { Territory, Month } = req.body;

    if (!Territory) {
      return res.status(400).json({ error: "Territory is required" });
    }

    let query = `SELECT 
         Calls_Score,
         RCPA_Score,
         Coverage_Score,
         Compliance_Score,
         Activity_Implementation_Score,
         Target_Achieved_Score,
         MSR_Achievement_Score,
         RX_Growth_Score,
         Brand_Performance_Index_Score
       FROM bgm_be_dashboard_ftm
       WHERE Territory = ?`;
    let params = [Territory];

    if (Month) {
      query += ` AND Period = ?`;
      params.push(Month);
    }

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({ message: "No record found for this Territory" });
    }

    const row = rows[0];

    // First set
    const totalScore3 = (
      (Number(row.Calls_Score) || 0) +
      (Number(row.RCPA_Score) || 0) +
      (Number(row.Coverage_Score) || 0) +
      (Number(row.Compliance_Score) || 0) +
      (Number(row.Activity_Implementation_Score) || 0)
    ).toFixed(2);

    const totalScore4 = (
      (Number(row.Target_Achieved_Score) || 0) +
      (Number(row.MSR_Achievement_Score) || 0) +
      (Number(row.RX_Growth_Score) || 0) +
      (Number(row.Brand_Performance_Index_Score) || 0)
    ).toFixed(2);


    res.json({
      totalScore3: Number(parseFloat(totalScore3).toFixed(2)),
      totalScore4: Number(parseFloat(totalScore4).toFixed(2))
    });

  } catch (error) {
    console.error("Error fetching YTD data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
// BM Efficiency Index endpoint
app.post('/bmEfficiency', async (req, res) => {
  try {
    const { Territory, Month } = req.body;

    if (!Territory) {
      return res.status(400).json({ error: "Territory is required" });
    }

    // 1) Fetch FTM (month) scores for BM
    let ftmQuery = `SELECT
         Target_Achieved_FTM_Score,
         BPI_FTM_Score,
         Span_Performance_FTM_Score,
         RX_Growth_FTM_Score,
         Viable_Territories_FTM_Score,

         Priority_Drs_Met_FTM_Score,
         Calls_FTM_Score,
         Coverage_Score2,
         Compliance_Score2,
         Marketing_Implementation_FTM_Score,
         MSP_Compliance_FTM_Score,
         Priority_RX_Drs_FTM_Score,
         MSR_Comp_FTM_Score,

         Outstanding_FTM_Score,
         Returns_Percent_FTM_Score,
         CA_FTM_Score,
         Closing_FTM_Score
       FROM bgm_bm_dashboard_ftm   -- your BM FTM table
       WHERE BM_Territory = ?`;
    let ftmParams = [Territory];

    if (Month) {
      ftmQuery += ` AND Period = ?`;
      ftmParams.push(Month);
    }

    const [ftmRows] = await pool.query(ftmQuery, ftmParams);

    // 2) Fetch YTD scores for BM
    let ytdQuery = `SELECT
         Target_Achieved_YTD_Score,
         Brand_Performance_Index_YTD_Score,
         Span_of_Performance_YTD_Score,
         RX_Growth_YTD_Score,
         Viable_Territories_YTD_Score,

         Priority_Drs_Met_YTD_Score,
         Calls_YTD_Score,
         Coverage_YTD_Score,
         Compliance_YTD_Score,
         Marketing_Implementation_YTD_Score,
         MSP_Compliance_YTD_Score,
         Priority_RX_Drs_YTD_Score,
         MSR_Compliance_YTD_Score,

         Returns_Percent_YTD_Score,
         CA_Percent_YTD_Score
       FROM bgm_bm_dashboard_ytd   -- your BM YTD table
       WHERE BM_Territory = ?`;
    let ytdParams = [Territory];

    if (Month) {
      ytdQuery += ` AND Period = ?`;
      ytdParams.push(Month);
    }

    const [ytdRows] = await pool.query(ytdQuery, ytdParams);

    if (!ftmRows.length || !ytdRows.length) {
      return res.status(404).json({ message: "No BM record found for this Territory" });
    }

    const ftm = ftmRows[0];
    const ytd = ytdRows[0];

    // ---------------------------
    // Business Performance totals
    // ---------------------------
    const bmBusinessMonth = (
      (Number(ftm.Target_Achieved_FTM_Score) || 0) +
      (Number(ftm.BPI_FTM_Score) || 0) +
      (Number(ftm.Span_Performance_FTM_Score) || 0) +
      (Number(ftm.RX_Growth_FTM_Score) || 0) +
      (Number(ftm.Viable_Territories_FTM_Score) || 0)
    ).toFixed(2);

    const bmBusinessYTD = (
      (Number(ytd.Target_Achieved_YTD_Score) || 0) +
      (Number(ytd.Brand_Performance_Index_YTD_Score) || 0) +
      (Number(ytd.Span_of_Performance_YTD_Score) || 0) +
      (Number(ytd.RX_Growth_YTD_Score) || 0) +
      (Number(ytd.Viable_Territories_YTD_Score) || 0)
    ).toFixed(2);

    // ---------------------------
    // Efforts & Effectiveness totals
    // ---------------------------
    const bmEffortMonth = (
      (Number(ftm.Priority_Drs_Met_FTM_Score) || 0) +
      (Number(ftm.Calls_FTM_Score) || 0) +
      (Number(ftm.Coverage_Score2) || 0) +
      (Number(ftm.Compliance_Score2) || 0) +
      (Number(ftm.Marketing_Implementation_FTM_Score) || 0) +
      (Number(ftm.MSP_Compliance_FTM_Score) || 0) +
      (Number(ftm.Priority_RX_Drs_FTM_Score) || 0) +
      (Number(ftm.MSR_Comp_FTM_Score) || 0)
    ).toFixed(2);

    const bmEffortYTD = (
      (Number(ytd.Priority_Drs_Met_YTD_Score) || 0) +
      (Number(ytd.Calls_YTD_Score) || 0) +
      (Number(ytd.Coverage_YTD_Score) || 0) +
      (Number(ytd.Compliance_YTD_Score) || 0) +
      (Number(ytd.Marketing_Implementation_YTD_Score) || 0) +
      (Number(ytd.MSP_Compliance_YTD_Score) || 0) +
      (Number(ytd.Priority_RX_Drs_YTD_Score) || 0) +
      (Number(ytd.MSR_Compliance_YTD_Score) || 0)
    ).toFixed(2);

    // ---------------------------
    // Hygiene totals
    // ---------------------------
    const bmHygieneMonth = (
      (Number(ftm.Outstanding_FTM_Score) || 0) +
      (Number(ftm.Returns_Percent_FTM_Score) || 0) +
      (Number(ftm.CA_FTM_Score) || 0) +
      (Number(ftm.Closing_FTM_Score) || 0)
    ).toFixed(2);

    const bmHygieneYTD = (
      (Number(ytd.Returns_Percent_YTD_Score) || 0) +
      (Number(ytd.CA_Percent_YTD_Score) || 0)
    ).toFixed(2);

    // Efficiency Index (BM)
    const efficiencyMonth = (
      Number(bmBusinessMonth) +
      Number(bmEffortMonth) +
      Number(bmHygieneMonth)
    ).toFixed(2);

    const efficiencyYTD = (
      Number(bmBusinessYTD) +
      Number(bmEffortYTD) +
      Number(bmHygieneYTD)
    ).toFixed(2);

    res.json({
      businessMonth: Number(bmBusinessMonth),
      businessYTD: Number(bmBusinessYTD),

      effortMonth: Number(bmEffortMonth),
      effortYTD: Number(bmEffortYTD),

      hygieneMonth: Number(bmHygieneMonth),
      hygieneYTD: Number(bmHygieneYTD),

      efficiencyMonth: Number(efficiencyMonth),
      efficiencyYTD: Number(efficiencyYTD),
    });
  } catch (error) {
    console.error("Error fetching BM efficiency:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
app.post('/blEfficiency', async (req, res) => {
  try {
    const { Territory, Month } = req.body;

    if (!Territory) {
      return res.status(400).json({ error: "Territory is required" });
    }

    // 1) Fetch FTM (month) scores for BL
    let ftmQuery = `SELECT
         -- Business Performance FTM
         Target_Achievement_Score,
         Territories_Achieving_Target_Score,
         Territories_Achieving_Cat_A_MEP_Score,
         Category_B_Sales_Vs_Target_Score,
         Corporate_Drs_Visited_Last_2M_Score,
         Corporate_Drs_Active_Prescribers_Score,

         -- Performance (Efforts) FTM  
         Hiring_Quality_Index_Score,
         Induction_Score,
         Infant_Attrition_Rate_Score,
         Overall_Attrition_Rate_Score,

         -- Hygiene FTM
         Returns_Score,
         Outstanding_Score,
         Marketing_Activity_Sales_Score,
         Closing_Score,

         -- Commitment FTM
         Team_Coverage_Score,
         Team_Compliance_Score,
         BM_Priority_Drs_Coverage_Score,
         TP_Adherence_Score,
         Secondary_Variance_Score,
         MSP_Compliance_Territories_Score,
         MSR_Compliance_Territories_Score

       FROM bgm_bl_dashboard_ftm
       WHERE BL_Territory = ?`;
    let ftmParams = [Territory];

    if (Month) {
      ftmQuery += ` AND Period = ?`;
      ftmParams.push(Month);
    }

    const [ftmRows] = await pool.query(ftmQuery, ftmParams);

    // 2) Fetch YTD scores for BL
    let ytdQuery = `SELECT
         -- Business Performance YTD
         Target_Achievement_Score,
         Territories_Achieving_Target_Score,
         Territories_Achieving_Cat_A_MEP_Score,
         Category_B_Sales_Vs_Target_Score,
        Corporate_Drs_Coverage_Score,
         Corporate_Drs_Active_Prescribers_Score,

         -- Performance (Efforts) YTD
         Hiring_Quality_Index_Score,
         Induction_Score,
         Infant_Attrition_Rate_Score,
         Overall_Attrition_Rate_Score,

         -- Hygiene YTD
         Returns_Score,
         Marketing_Activity_Sales_Score,

         -- Commitment YTD
         Team_Coverage_Score,
         Team_Compliance_Score,
         BM_Priority_Drs_Coverage_Score,
         TP_Adherence_Score,
         Secondary_Variance_Score,
         MSP_Compliance_Territories_Score,
         MSR_Compliance_Territories_Score

       FROM bgm_bl_dashboard_ytd
       WHERE BL_Territory = ?`;
    let ytdParams = [Territory];

    if (Month) {
      ytdQuery += ` AND Period = ?`;
      ytdParams.push(Month);
    }

    const [ytdRows] = await pool.query(ytdQuery, ytdParams);

    if (!ftmRows.length || !ytdRows.length) {
      return res.status(404).json({ message: "No BL record found for this Territory" });
    }

    const ftm = ftmRows[0];
    const ytd = ytdRows[0];

    // ---------------------------
    // Business Performance totals
    // ---------------------------
    const blBusinessMonth = (
      (Number(ftm.Target_Achievement_Score) || 0) +
      (Number(ftm.Territories_Achieving_Target_Score) || 0) +
      (Number(ftm.Territories_Achieving_Cat_A_MEP_Score) || 0) +
      (Number(ftm.Category_B_Sales_Vs_Target_Score) || 0) +
      (Number(ftm.Corporate_Drs_Visited_Last_2M_Score) || 0) +
      (Number(ftm.Corporate_Drs_Active_Prescribers_Score) || 0)
    ).toFixed(2);

    const blBusinessYTD = (
      (Number(ytd.Target_Achievement_Score) || 0) +
      (Number(ytd.Territories_Achieving_Target_Score) || 0) +
      (Number(ytd.Territories_Achieving_Cat_A_MEP_Score) || 0) +
      
      (Number(ytd.Category_B_Sales_Vs_Target_Score) || 0) +
(Number(ytd.Corporate_Drs_Coverage_Score) || 0) +
      (Number(ytd.Corporate_Drs_Active_Prescribers_Score) || 0)
    ).toFixed(2);

    // ---------------------------
    // Performance/Efforts totals
    // ---------------------------
    const blEffortMonth = (
      (Number(ftm.Hiring_Quality_Index_Score) || 0) +
      (Number(ftm.Induction_Score) || 0) +
      (Number(ftm.Infant_Attrition_Rate_Score) || 0) +
      (Number(ftm.Overall_Attrition_Rate_Score) || 0)
    ).toFixed(2);

    const blEffortYTD = (
      (Number(ytd.Hiring_Quality_Index_Score) || 0) +
      (Number(ytd.Induction_Score) || 0) +
      (Number(ytd.Infant_Attrition_Rate_Score) || 0) +
      (Number(ytd.Overall_Attrition_Rate_Score) || 0)
    ).toFixed(2);

    // ---------------------------
    // Hygiene totals
    // ---------------------------
    const blHygieneMonth = (
      (Number(ftm.Returns_Score) || 0) +
      (Number(ftm.Outstanding_Score) || 0) +
      (Number(ftm.Marketing_Activity_Sales_Score) || 0) +
      (Number(ftm.Closing_Score) || 0)
    ).toFixed(2);

    const blHygieneYTD = (
      (Number(ytd.Returns_Score) || 0) +
      (Number(ytd.Marketing_Activity_Sales_Score) || 0)
    ).toFixed(2);

    // ---------------------------
    // Commitment totals
    // ---------------------------
    const blCommitmentMonth = (
      (Number(ftm.Team_Coverage_Score) || 0) +
      (Number(ftm.Team_Compliance_Score) || 0) +
      (Number(ftm.BM_Priority_Drs_Coverage_Score) || 0) +
      (Number(ftm.TP_Adherence_Score) || 0) +
      (Number(ftm.Secondary_Variance_Score) || 0) +
      (Number(ftm.MSP_Compliance_Territories_Score) || 0) +
      (Number(ftm.MSR_Compliance_Territories_Score) || 0)
    ).toFixed(2);

    const blCommitmentYTD = (
      (Number(ytd.Team_Coverage_Score) || 0) +
      (Number(ytd.Team_Compliance_Score) || 0) +
      (Number(ytd.BM_Priority_Drs_Coverage_Score) || 0) +
      (Number(ytd.TP_Adherence_Score) || 0) +
      (Number(ytd.Secondary_Variance_Score) || 0) +
      (Number(ytd.MSP_Compliance_Territories_Score) || 0) +
      (Number(ytd.MSR_Compliance_Territories_Score) || 0)
    ).toFixed(2);

    // ---------------------------
    // Efficiency Index (BL)
    // ---------------------------
    const efficiencyMonth = (
      Number(blBusinessMonth) +
      Number(blEffortMonth) +
      Number(blHygieneMonth) +
      Number(blCommitmentMonth)
    ).toFixed(2);

    const efficiencyYTD = (
      Number(blBusinessYTD) +
      Number(blEffortYTD) +
      Number(blHygieneYTD) +
      Number(blCommitmentYTD)
    ).toFixed(2);

    res.json({
      businessMonth: Number(blBusinessMonth),
      businessYTD: Number(blBusinessYTD),

      effortMonth: Number(blEffortMonth),
      effortYTD: Number(blEffortYTD),

      hygieneMonth: Number(blHygieneMonth),
      hygieneYTD: Number(blHygieneYTD),

      commitmentMonth: Number(blCommitmentMonth),
      commitmentYTD: Number(blCommitmentYTD),

      efficiencyMonth: Number(efficiencyMonth),
      efficiencyYTD: Number(efficiencyYTD),
    });

  } catch (error) {
    console.error("Error fetching BL efficiency:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
app.post('/bhEfficiency', async (req, res) => {
  try {
    const { Territory, Division, Month } = req.body;

    if (!Territory) {
      return res.status(400).json({ error: "Territory is required" });
    }

    // -----------------------------
    // Determine tables and division filter
    // -----------------------------
    let ftmTable = "bgm_bh_dashboard_ftm";
    let ytdTable = "bgm_bh_dashboard_ytd";
    let divisionFilter = Division;

    // Handle special divisions
    if (Division === "Glamus_Gladius") {
      ftmTable = "bgm_bh_dashboard_glamus_ftm";
      ytdTable = "bgm_bh_dashboard_glamus_ytd";
      divisionFilter = "GLADIUS";
    } else if (Division === "Glamus_Stimulus") {
      ftmTable = "bgm_bh_dashboard_glamus_ftm";
      ytdTable = "bgm_bh_dashboard_glamus_ytd";
      divisionFilter = "STIMULUS";
    }

    // -----------------------------
    // Build dynamic queries
    // -----------------------------
    let ftmQuery = `SELECT
      -- Business Performance
      Target_Achievement_Score,
      Territories_Achieving_Cat_A_MEP_Score,
      Category_B_Sales_Vs_Target_Score,
      BMs_Achieving_Target_Score,
      Span_of_Performance_Score,

      -- Performance / Efforts
      Overall_Attrition_Rate_Score,
      Secondary_Variance_Score,
      MSP_Compliance_Territories_Score,
      MSR_Compliance_Territories_Score,
      BE_Active_vs_Sanctioned_Score,
      BM_BL_Active_vs_Sanctioned_Score,

      -- Hygiene
      Returns_Score,
      Outstanding_Score,
      Marketing_Activity_Sales_Score,
      Closing_Score,

      -- Commitment
      Calls_Score,
      Coverage_Score,
      Compliance_Score,
      Priority_Drs_Coverage_Score,
      Priority_RX_Drs_Score,
      BM_Priority_Drs_Coverage_Score
    FROM ${ftmTable}
    WHERE BH_Territory = ?`;

    let ytdQuery = `SELECT
      Target_Achievement_Score,
      Territories_Achieving_Cat_A_MEP_Score,
      Category_B_Sales_Vs_Target_Score,
      BMs_Achieving_Target_Score,
      Span_of_Performance_Score,

      Overall_Attrition_Rate_Score,
      Secondary_Variance_Score,
      MSP_Compliance_Territories_Score,
      MSR_Compliance_Territories_Score,

      Returns_Score,
      Marketing_Activity_Sales_Score,

      Calls_Score,
      Team_Coverage_Score,
      Team_Compliance_Score,
      Corporate_Drs_Coverage_Score,
      Corporate_Drs_Active_Prescribers_Score,
      BM_Priority_Drs_Coverage_Score
    FROM ${ytdTable}
    WHERE BH_Territory = ?`;

    let ftmParams = [Territory];
    let ytdParams = [Territory];

    // Add division filter if provided
    if (divisionFilter) {
      ftmQuery += ` AND division = ?`;
      ytdQuery += ` AND division = ?`;
      ftmParams.push(divisionFilter);
      ytdParams.push(divisionFilter);
    }

    // Add month filter if provided
    if (Month) {
      ftmQuery += ` AND Period = ?`;
      ytdQuery += ` AND Period = ?`;
      ftmParams.push(Month);
      ytdParams.push(Month);
    }

    // -----------------------------
    // Execute queries
    // -----------------------------
    const [ftmRows] = await pool.query(ftmQuery, ftmParams);
    const [ytdRows] = await pool.query(ytdQuery, ytdParams);

    if (!ftmRows.length || !ytdRows.length) {
      return res.status(404).json({
        message: divisionFilter
          ? `No BH Efficiency record found for Territory: ${Territory}, Division: ${divisionFilter}`
          : `No BH Efficiency record found for Territory: ${Territory}`
      });
    }

    const ftm = ftmRows[0];
    const ytd = ytdRows[0];

    // =============================
    // BUSINESS PERFORMANCE
    // =============================
    const businessMonth =
      (Number(ftm.Target_Achievement_Score) || 0) +
      (Number(ftm.Territories_Achieving_Cat_A_MEP_Score) || 0) +
      (Number(ftm.Category_B_Sales_Vs_Target_Score) || 0) +
      (Number(ftm.BMs_Achieving_Target_Score) || 0) +
      (Number(ftm.Span_of_Performance_Score) || 0);

    const businessYTD =
      (Number(ytd.Target_Achievement_Score) || 0) +
      (Number(ytd.Territories_Achieving_Cat_A_MEP_Score) || 0) +
      (Number(ytd.Category_B_Sales_Vs_Target_Score) || 0) +
      (Number(ytd.BMs_Achieving_Target_Score) || 0) +
      (Number(ytd.Span_of_Performance_Score) || 0);

    // =============================
    // PERFORMANCE / EFFORTS
    // =============================
    const effortMonth =
      (Number(ftm.Overall_Attrition_Rate_Score) || 0) +
      (Number(ftm.Secondary_Variance_Score) || 0) +
      (Number(ftm.MSP_Compliance_Territories_Score) || 0) +
      (Number(ftm.MSR_Compliance_Territories_Score) || 0) +
      (Number(ftm.BE_Active_vs_Sanctioned_Score) || 0) +
      (Number(ftm.BM_BL_Active_vs_Sanctioned_Score) || 0);

    const effortYTD =
      (Number(ytd.Overall_Attrition_Rate_Score) || 0) +
      (Number(ytd.Secondary_Variance_Score) || 0) +
      (Number(ytd.MSP_Compliance_Territories_Score) || 0) +
      (Number(ytd.MSR_Compliance_Territories_Score) || 0);

    // =============================
    // HYGIENE
    // =============================
    const hygieneMonth =
      (Number(ftm.Returns_Score) || 0) +
      (Number(ftm.Outstanding_Score) || 0) +
      (Number(ftm.Marketing_Activity_Sales_Score) || 0) +
      (Number(ftm.Closing_Score) || 0);

    const hygieneYTD =
      (Number(ytd.Returns_Score) || 0) +
      (Number(ytd.Marketing_Activity_Sales_Score) || 0);

    // =============================
    // COMMITMENT
    // =============================
    const commitmentMonth =
      (Number(ftm.Calls_Score) || 0) +
      (Number(ftm.Coverage_Score) || 0) +
      (Number(ftm.Compliance_Score) || 0) +
      (Number(ftm.Priority_Drs_Coverage_Score) || 0) +
      (Number(ftm.Priority_RX_Drs_Score) || 0) +
      (Number(ftm.BM_Priority_Drs_Coverage_Score) || 0);

    const commitmentYTD =
      (Number(ytd.Calls_Score) || 0) +
      (Number(ytd.Team_Coverage_Score) || 0) +
      (Number(ytd.Team_Compliance_Score) || 0) +
      (Number(ytd.Corporate_Drs_Coverage_Score) || 0) +
      (Number(ytd.Corporate_Drs_Active_Prescribers_Score) || 0) +
      (Number(ytd.BM_Priority_Drs_Coverage_Score) || 0);

    // =============================
    // EFFICIENCY INDEX
    // =============================
    const efficiencyMonth =
      businessMonth + effortMonth + hygieneMonth + commitmentMonth;

    const efficiencyYTD =
      businessYTD + effortYTD + hygieneYTD + commitmentYTD;

    res.json({
      businessMonth,
      businessYTD,
      effortMonth,
      effortYTD,
      hygieneMonth,
      hygieneYTD,
      commitmentMonth,
      commitmentYTD,
      efficiencyMonth,
      efficiencyYTD
    });

  } catch (err) {
    console.error("BH Efficiency error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post('/sbuhEfficiency', async (req, res) => {
  try {
    const { Territory, Division, Month } = req.body;

    if (!Territory) {
      return res.status(400).json({ error: "Territory is required" });
    }

    // -----------------------------
    // Build dynamic queries with Division filter
    // -----------------------------
    let ftmQuery = `SELECT
      -- Business Performance
      Target_Achievement_Score,
      Territories_Achieving_Cat_A_MEP_Score,
      Category_B_Sales_Vs_Target_Score,
      BMs_Achieving_Target_Score,
      Span_of_Performance_Score,

      -- Performance / Efforts
      Overall_Attrition_Rate_Score,
      Secondary_Variance_Score,
      MSP_Compliance_Territories_Score,
      MSR_Compliance_Territories_Score,
      BE_Active_vs_Sanctioned_Score,
      BM_BL_Active_vs_Sanctioned_Score,

      -- Hygiene
      Returns_Score,
      Outstanding_Score,
      Marketing_Activity_Sales_Score,
      Closing_Score,

      -- Commitment
      Calls_Score,
      Coverage_Score,
      Compliance_Score,
      Priority_Drs_Coverage_Score,
      Priority_RX_Drs_Score,
      BM_Priority_Drs_Coverage_Score
    FROM bgm_sbuh_dashboard_ftm
    WHERE SBUH_Territory = ?`;

    let ytdQuery = `SELECT
      Target_Achievement_Score,
      Territories_Achieving_Cat_A_MEP_Score,
      Category_B_Sales_Vs_Target_Score,
      BMs_Achieving_Target_Score,
      Span_of_Performance_Score,

      Overall_Attrition_Rate_Score,
      Secondary_Variance_Score,
      MSP_Compliance_Territories_Score,
      MSR_Compliance_Territories_Score,

      Returns_Score,
      Marketing_Activity_Sales_Score,

      Calls_Score,
      Team_Coverage_Score,
      Team_Compliance_Score,
      Corporate_Drs_Coverage_Score,
      Corporate_Drs_Active_Prescribers_Score,
      BM_Priority_Drs_Coverage_Score
    FROM bgm_sbuh_dashboard_ytd
    WHERE SBUH_Territory = ?`;

    let ftmParams = [Territory];
    let ytdParams = [Territory];

    // Add division filter if provided
    if (Division) {
      ftmQuery += ` AND division = ?`;
      ytdQuery += ` AND division = ?`;
      ftmParams.push(Division);
      ytdParams.push(Division);
    }

    if (Month) {
      ftmQuery += ` AND Period = ?`;
      ytdQuery += ` AND Period = ?`;
      ftmParams.push(Month);
      ytdParams.push(Month);
    }

    // -----------------------------
    // Execute queries
    // -----------------------------
    const [ftmRows] = await pool.query(ftmQuery, ftmParams);
    const [ytdRows] = await pool.query(ytdQuery, ytdParams);

    if (!ftmRows.length || !ytdRows.length) {
      return res.status(404).json({
        message: Division
          ? `No SBUH Efficiency record found for Territory: ${Territory}, Division: ${Division}`
          : `No SBUH Efficiency record found for Territory: ${Territory}`
      });
    }

    const ftm = ftmRows[0];
    const ytd = ytdRows[0];

    // =============================
    // BUSINESS PERFORMANCE
    // =============================
    const businessMonth =
      (Number(ftm.Target_Achievement_Score) || 0) +
      (Number(ftm.Territories_Achieving_Cat_A_MEP_Score) || 0) +
      (Number(ftm.Category_B_Sales_Vs_Target_Score) || 0) +
      (Number(ftm.BMs_Achieving_Target_Score) || 0) +
      (Number(ftm.Span_of_Performance_Score) || 0);

    const businessYTD =
      (Number(ytd.Target_Achievement_Score) || 0) +
      (Number(ytd.Territories_Achieving_Cat_A_MEP_Score) || 0) +
      (Number(ytd.Category_B_Sales_Vs_Target_Score) || 0) +
      (Number(ytd.BMs_Achieving_Target_Score) || 0) +
      (Number(ytd.Span_of_Performance_Score) || 0);

    // =============================
    // PERFORMANCE / EFFORTS
    // =============================
    const effortMonth =
      (Number(ftm.Overall_Attrition_Rate_Score) || 0) +
      (Number(ftm.Secondary_Variance_Score) || 0) +
      (Number(ftm.MSP_Compliance_Territories_Score) || 0) +
      (Number(ftm.MSR_Compliance_Territories_Score) || 0) +
      (Number(ftm.BE_Active_vs_Sanctioned_Score) || 0) +
      (Number(ftm.BM_BL_Active_vs_Sanctioned_Score) || 0);

    const effortYTD =
      (Number(ytd.Overall_Attrition_Rate_Score) || 0) +
      (Number(ytd.Secondary_Variance_Score) || 0) +
      (Number(ytd.MSP_Compliance_Territories_Score) || 0) +
      (Number(ytd.MSR_Compliance_Territories_Score) || 0);

    // =============================
    // HYGIENE
    // =============================
    const hygieneMonth =
      (Number(ftm.Returns_Score) || 0) +
      (Number(ftm.Outstanding_Score) || 0) +
      (Number(ftm.Marketing_Activity_Sales_Score) || 0) +
      (Number(ftm.Closing_Score) || 0);

    const hygieneYTD =
      (Number(ytd.Returns_Score) || 0) +
      (Number(ytd.Marketing_Activity_Sales_Score) || 0);

    // =============================
    // COMMITMENT
    // =============================
    const commitmentMonth =
      (Number(ftm.Calls_Score) || 0) +
      (Number(ftm.Coverage_Score) || 0) +
      (Number(ftm.Compliance_Score) || 0) +
      (Number(ftm.Priority_Drs_Coverage_Score) || 0) +
      (Number(ftm.Priority_RX_Drs_Score) || 0) +
      (Number(ftm.BM_Priority_Drs_Coverage_Score) || 0);

    const commitmentYTD =
      (Number(ytd.Calls_Score) || 0) +
      (Number(ytd.Team_Coverage_Score) || 0) +
      (Number(ytd.Team_Compliance_Score) || 0) +
      (Number(ytd.Corporate_Drs_Coverage_Score) || 0) +
      (Number(ytd.Corporate_Drs_Active_Prescribers_Score) || 0) +
      (Number(ytd.BM_Priority_Drs_Coverage_Score) || 0);

    // =============================
    // EFFICIENCY INDEX
    // =============================
    const efficiencyMonth = businessMonth + effortMonth + hygieneMonth + commitmentMonth;
    const efficiencyYTD = businessYTD + effortYTD + hygieneYTD + commitmentYTD;

    res.json({
      businessMonth,
      businessYTD,
      effortMonth,
      effortYTD,
      hygieneMonth,
      hygieneYTD,
      commitmentMonth,
      commitmentYTD,
      efficiencyMonth,
      efficiencyYTD
    });

  } catch (err) {
    console.error("SBUH Efficiency error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});



app.post('/getDivisions', async (req, res) => {
  try {
    const { Territory } = req.body;

    if (!Territory) {
      return res.status(400).json({ error: "Territory is required" });
    }

    // 1️⃣ First check BH table
    const [bhRows] = await pool.query(
      `SELECT DISTINCT division 
       FROM bgm_bh_dashboard_ftm 
       WHERE BH_Territory = ? 
       ORDER BY division`,
      [Territory]
    );

    if (bhRows.length > 0) {
      const divisions = bhRows.map(row => row.division).filter(Boolean);
      return res.json({ divisions });
    }

    // 2️⃣ If nothing found, check SBUH table
    const [sbuhRows] = await pool.query(
      `SELECT DISTINCT division 
       FROM bgm_sbuh_dashboard_ftm 
       WHERE SBUH_Territory = ? 
       ORDER BY division`,
      [Territory]
    );

    const divisions = sbuhRows.map(row => row.division).filter(Boolean);

    // 3️⃣ Return divisions (or empty array if none)
    return res.json({ divisions });

  } catch (error) {
    console.error("Error fetching divisions:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});



app.post('/putEscalations', async (req, res) => {
  try {
    const dataToInsert = req.body;
    const dataArray = Array.isArray(dataToInsert) ? dataToInsert : [dataToInsert];

    if (dataArray.length === 0) {
      return res.status(400).send('No data received');
    }

    const values = dataArray.map(row => [
      row.metric,
      row.message,
      row.role,
      row.employee_name,
      row.territory_code,
      row.employee_code,
      row.entry_date
    ]);

    const query = `
      INSERT INTO escalations (
        metric,
        message,
        role,
        employee_name,
        territory_code,
        employee_code,
        entry_date
      ) VALUES ?
    `;

    await pool.query(query, [values]);
    return res.status(201).send('success');
  } catch (err) {
    console.error('Error /putEscalations:', err);
    return res.status(500).send('Internal Server Error');
  }
});

// ------------------------------------temporary regarding only be data

// ---------- Get commitments by territory ----------
app.get("/getData/:territory", async (req, res) => {
  try {
    const territory = req.params.territory;
    const { Month } = req.query;

    let query = `
      SELECT 
        id,
        metric,
        sender,
        sender_territory,
        receiver_territory,
        commitment,
        goal,
        DATE_FORMAT(received_date, '%Y-%m-%d') AS received_date,
        DATE_FORMAT(goal_date, '%Y-%m-%d') AS goal_date,
        DATE_FORMAT(receiver_commit_date, '%Y-%m-%d') AS receiver_commit_date
      FROM commitments
      WHERE receiver_territory = ?
    `;
    let params = [territory];

    if (Month) {
      // Month format 'YYYY-MM'
      query += ` AND received_date LIKE ?`;
      params.push(`${Month}%`);
    }

    query += ` ORDER BY received_date DESC`;

    const [rows] = await pool.query(query, params);

    res.json(rows);
  } catch (err) {
    console.error("Error fetching commitments:", err);
    res.status(500).send("Server error");
  }
});

app.get("/getReports/:territory", async (req, res) => {
  try {
    const territory = req.params.territory;
    const { period } = req.query; // e.g. ?period=2026-03

    let query = `
      SELECT *
      FROM day_report
      WHERE territory = ?
    `;

    let params = [territory];

    if (period) {
      // If period stored like 'YYYY-MM'
      query += ` AND period = ?`;
      params.push(period);

      // OR if period is a DATE column, use this instead:
      // query += ` AND DATE_FORMAT(period, '%Y-%m') = ?`;
      // params.push(period);
    }

    query += ` ORDER BY period DESC`;

    const [rows] = await pool.query(query, params);

    // Exclude unwanted columns from the response
    const EXCLUDED_COLS = new Set(["Division", "Emp_Code", "Emp_Name", "Role", "status", "Region","HQ"]);
    const filtered = rows.map(row => {
      const cleaned = {};
      for (const key of Object.keys(row)) {
        if (!EXCLUDED_COLS.has(key)) cleaned[key] = row[key];
      }
      return cleaned;
    });

    res.json(filtered);
  } catch (err) {
    console.error("Error fetching reports:", err);
    res.status(500).send("Server error");
  }
});
app.get("/getCampReports/:territory", async (req, res) => {
  try {
    const territory = req.params.territory;
    const { period } = req.query; // e.g. ?period=2026-03

    let query = `
      SELECT *
      FROM campaign_report
      WHERE territory = ?
    `;

    let params = [territory];

    if (period) {
      // If period stored like 'YYYY-MM'
      query += ` AND period = ?`;
      params.push(period);

      // OR if period is a DATE column, use this instead:
      // query += ` AND DATE_FORMAT(period, '%Y-%m') = ?`;
      // params.push(period);
    }

    query += ` ORDER BY period DESC`;

    const [rows] = await pool.query(query, params);

    // Exclude unwanted columns from the response
    const EXCLUDED_COLS = new Set(["Division", "Emp_Code", "Emp_Name",  "status","Region","HQ"]);
    const filtered = rows.map(row => {
      const cleaned = {};
      for (const key of Object.keys(row)) {
        if (!EXCLUDED_COLS.has(key)) cleaned[key] = row[key];
      }
      return cleaned;
    });

    res.json(filtered);
  } catch (err) {
    console.error("Error fetching campaign reports:", err);
    res.status(500).send("Server error");
  }
});
app.get("/getInventoryReports/:territory", async (req, res) => {
  try {
    const territory = req.params.territory;
    const { period } = req.query; // e.g. ?period=2026-03

    let query = `
      SELECT *
      FROM inventory_report
      WHERE territory = ?
    `;

    let params = [territory];

    if (period) {
      // If period stored like 'YYYY-MM'
      query += ` AND period = ?`;
      params.push(period);

      // OR if period is a DATE column, use this instead:
      // query += ` AND DATE_FORMAT(period, '%Y-%m') = ?`;
      // params.push(period);
    }

    query += ` ORDER BY period DESC`;

    const [rows] = await pool.query(query, params);

    // Exclude unwanted columns from the response
    const EXCLUDED_COLS = new Set(["Division", "Emp_Code", "Emp_Name",  "status","Region","HQ"]);
    const filtered = rows.map(row => {
      const cleaned = {};
      for (const key of Object.keys(row)) {
        if (!EXCLUDED_COLS.has(key)) cleaned[key] = row[key];
      }
      return cleaned;
    });

    res.json(filtered);
  } catch (err) {
    console.error("Error fetching campaign reports:", err);
    res.status(500).send("Server error");
  }
});
app.get("/DayReportManager/:territory", async (req, res) => {
  try {
    const territory = req.params.territory;
    const { period } = req.query; // e.g. ?period=2026-03

    let query = `
      SELECT *
      FROM day_report_manager
      WHERE territory = ?
    `;

    let params = [territory];

    if (period) {
      // If period stored like 'YYYY-MM'
      query += ` AND period = ?`;
      params.push(period);

      // OR if period is a DATE column, use this instead:
      // query += ` AND DATE_FORMAT(period, '%Y-%m') = ?`;
      // params.push(period);
    }

    query += ` ORDER BY period DESC`;

    const [rows] = await pool.query(query, params);

    // Exclude unwanted columns from the response
    const EXCLUDED_COLS = new Set(["Division", "Emp_Code", "Emp_Name",  "status","Region","HQ","Period","Territory","Role"]);
    const filtered = rows.map(row => {
      const cleaned = {};
      for (const key of Object.keys(row)) {
        if (!EXCLUDED_COLS.has(key)) cleaned[key] = row[key];
      }
      return cleaned;
    });

    res.json(filtered);
  } catch (err) {
    console.error("Error fetching campaign reports:", err);
    res.status(500).send("Server error");
  }
});

app.get("/PrDoctorReport/:territory", async (req, res) => {
  try {
    const territory = req.params.territory;
    const { period, role } = req.query; // ← read role from query params

    // Map role to the correct column name
    const roleColumnMap = {
      BE: "Territory",
      BM: "BM_Territory",
      BL: "BL_Territory",
      BH: "BH_Territory",
      SBUH: "SBUH_Territory",
    };
    const rolePriorityColumnMap = {
      BE: "BE_Priority_Dr",
      BM: "BM_Priority_Dr",
      BL: "BL_Priority_Dr",
      BH: "BH_Priority_Dr",
      SBUH: "SBUH_Priority_Dr",
    };

    const territoryColumn = roleColumnMap[role];
    const priorityColumn = rolePriorityColumnMap[role];

    if (!territoryColumn || !priorityColumn) {
      return res.status(400).json({ error: `Invalid or missing role: ${role}` });
    }

    // Safe to interpolate column name since it comes from our own map, not user input
    let query = `
      SELECT *
      FROM doctor_summary
      WHERE ${territoryColumn} = ? and ${priorityColumn} = '1'
    `;

    let params = [territory];

    if (period) {
      query += ` AND period = ?`;
      // Use below instead if period is a DATE column:
      // query += ` AND DATE_FORMAT(period, '%Y-%m') = ?`;
      params.push(period);
    }

    query += ` ORDER BY period DESC`;

    const [rows] = await pool.query(query, params);

    const EXCLUDED_COLS = new Set([
      "Division", "Region", "HQ",
      "Territory", "status", "Doctor_ID", "Dr_Name", "Patch", 
      "Speciality", "RX_Status", "RX_Status_Marked_by_BE",
      "BE_Visit_Dates", "BM_Visit_Dates", "BL_Visit_Dates", 
      "BH_Visit_Dates", "SBUH_Visit_Dates"

    ]);

    const filtered = rows.map((row) => {
      const cleaned = {};
      for (const key of Object.keys(row)) {
        if (EXCLUDED_COLS.has(key)) cleaned[key] = row[key];
      }
      return cleaned;
    });

    res.json(filtered);
  } catch (err) {
    console.error("Error fetching doctor reports:", err);
    res.status(500).send("Server error");
  }
});
app.get("/Prescriber/:territory", async (req, res) => {
  try {
    const territory = req.params.territory;
    const { period, role } = req.query; // ← read role from query params

    


    
    // Safe to interpolate column name since it comes from our own map, not user input
    let query = `
      SELECT *
      FROM doctor_prescriber_activity
      WHERE BE_Territory = ?
    `;

    let params = [territory];

    if (period) {
      query += ` AND period = ?`;
      // Use below instead if period is a DATE column:
      // query += ` AND DATE_FORMAT(period, '%Y-%m') = ?`;
      params.push(period);
    }

    query += ` ORDER BY period DESC`;

    const [rows] = await pool.query(query, params);

    const EXCLUDED_COLS = new Set([
      "Division", "Region", "HQ","id","Period","BE_Territory","Doctor_ID"
      // "Territory", "status", "Doctor_ID", "Dr_Name", "Patch", 
      // "Speciality", "RX_Status", "RX_Status_Marked_by_BE",
      // "BE_Visit_Dates", "BM_Visit_Dates", "BL_Visit_Dates", 
      // "BH_Visit_Dates", "SBUH_Visit_Dates"

    ]);

    const filtered = rows.map((row) => {
      const cleaned = {};
      for (const key of Object.keys(row)) {
        if (!EXCLUDED_COLS.has(key)) cleaned[key] = row[key];
      }
      return cleaned;
    });

    res.json(filtered);
  } catch (err) {
    console.error("Error fetching doctor reports:", err);
    res.status(500).send("Server error");
  }
});


// ---------- Update receiver commit date ----------
app.put('/updateCommitment', async (req, res) => {
  try {
    const { id, receiver_commit_date, goal } = req.body;

    if (!id) {
      return res.status(400).send("Row ID is required");
    }

    const fields = [];
    const values = [];

    if (receiver_commit_date !== undefined) {
      fields.push("receiver_commit_date = ?");
      values.push(receiver_commit_date);
    }

    if (goal !== undefined) {
      fields.push("goal = ?");
      values.push(goal);
    }

    if (fields.length === 0) {
      return res.status(400).send("Nothing to update");
    }

    values.push(id);

    const query = `
      UPDATE commitments
      SET ${fields.join(", ")}
      WHERE id = ?
    `;

    const [result] = await pool.query(query, values);

    if (result.affectedRows === 0) {
      return res.status(404).send("No row found with this id");
    }

    res.status(200).send("Updated successfully");
  } catch (err) {
    console.error("Error /updateCommitment:", err);
    res.status(500).send("Internal Server Error");
  }
});




// ---------- Add disclosure ----------

app.post("/addEscalation", async (req, res) => {
  try {
    const {
      metric,
      sender,
      sender_code,
      sender_territory,
      from,
      to,
      received_date,
      goal_date,
      message
    } = req.body;

    if (
      !metric ||
      !sender ||
      !sender_code ||
      !sender_territory ||
      from === undefined ||
      to === undefined ||
      !received_date ||
      !goal_date
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const query = `
      INSERT INTO disclosures
      (metric, sender, sender_code, sender_territory, \`from\`, \`to\`, received_date, goal_date, message) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [metric, sender, sender_code, sender_territory, from, to, received_date, goal_date, message || null];
    await pool.query(query, values);
    res.status(201).json({ message: "Commitment added successfully" });
  } catch (error) {
    console.error("Error /addEscalation:", error);
    res.status(500).json({ error: "Database error" });
  }
});
// 📌 Get all information records

app.get('/getInfo', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM information ORDER BY received_date DESC');
    res.json(rows);
  } catch (err) {
    console.error('Error /getInfo:', err);
    res.status(500).send('Internal Server Error');
  }
});



// ---------- Insert info ----------
app.post('/putInfo', async (req, res) => {
  try {
    const data = Array.isArray(req.body) ? req.body : [req.body];

    if (data.length === 0) {
      return res.status(400).json({ error: "No data received" });
    }

    const values = data.map(row => {
      let personalizedMsg = row.message;

      // Replace placeholders
      if (personalizedMsg.includes("@name")) {
        personalizedMsg = personalizedMsg.replace(/@name/g, row.receiver);
      }
      if (personalizedMsg.includes("@metric") && row.metric !== undefined) {
        personalizedMsg = personalizedMsg.replace(/@metric/g, row.metric);
      }

      return [
        row.sender || null,
        row.sender_code || null,
        row.sender_territory || null,
        row.receiver || null,
        row.receiver_code || null,
        row.receiver_territory || null,
        row.received_date || null,
        personalizedMsg || null
      ];
    });



    const query = `
      INSERT INTO information (
        sender,
        sender_code,
        sender_territory,
        receiver,
        receiver_code,
        receiver_territory,
        received_date,
        message
      ) VALUES ?
    `;

    // ✅ Use query, not execute
    await pool.query(query, [values]);

    return res.status(201).json({ success: true, inserted: values.length });
  } catch (err) {
    console.error("Error /putInfo:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});



// ---------- Filter data (VALIDATE metric to prevent injection) ----------
const ALLOWED_METRICS = ['Coverage', 'Compliance', 'Doctor_Calls', 'Chemist_Met']; // <- Replace with your actual numeric columns
app.post("/filterData", async (req, res) => {
  try {
    const { metric, from, to, Month } = req.body;

    if (!metric || from === undefined || to === undefined) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!ALLOWED_METRICS.includes(metric)) {
      return res.status(400).json({ error: "Invalid metric" });
    }

    let query = `
      SELECT Territory, Emp_Code, Emp_Name, \`${metric}\`
      FROM bgm_be_dashboard_ftm
      WHERE \`${metric}\` BETWEEN ? AND ?  and Emp_Code != 'Vacant'
    `;
    let params = [from, to];

    if (Month) {
      query += ` AND Period = ?`;
      params.push(Month);
    }

    const [rows] = await pool.query(query, params);
    res.json(rows);

  } catch (error) {
    console.error("Error /filterData:", error);
    res.status(500).json({ error: "Database error" });
  }
});

// ---------- Messages by territory ----------
app.post("/getMessagesByTerritory", async (req, res) => {
  try {
    const { receiver_territory } = req.body;
    if (!receiver_territory) {
      return res.status(400).json({ error: "receiver_territory is required" });
    }

    const query = `
      SELECT * 
      FROM information
      WHERE receiver_territory = ?
    `;
    const [rows] = await pool.query(query, [receiver_territory]);
    res.json({ results: rows });
  } catch (error) {
    console.error("Error /getMessagesByTerritory:", error);
    res.status(500).json({ error: "Database error" });
  }
});

// ---------- Graceful shutdown handlers ----------
process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at:', p, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
});



// -----------------------------------------------------------------------------------
// ---------- API 1: Table 1 (Stockist, Product, Sales) ----------
app.post('/getTable1', async (req, res) => {
  try {
    const { territory } = req.body;
    if (!territory) return res.status(400).json({ error: 'territory is required' });

    const [rows] = await pool.query(
      `SELECT stockistname, ProductName, Sales 
       FROM sales_data_testing_7 
       WHERE Territory = ?`,
      [territory]
    );

    res.json({ results: rows });
  } catch (err) {
    console.error('Error /getTable1:', err);
    res.status(500).json({ error: 'Database error' });
  }
});


// ---------- API 2: Table 2 (Pivot Summary View) ----------

app.post('/getTable2', async (req, res) => {
  try {
    const { territory } = req.body;
    if (!territory) return res.status(400).json({ error: 'territory is required' });

    const [rows] = await pool.query(
      `SELECT stockistname, ProductName, Sales 
       FROM sales_data
       WHERE Territory = ?`,
      [territory]
    );

    // Pivot transformation in JS
    const pivot = {};
    rows.forEach(r => {
      if (!pivot[r.ProductName]) {
        pivot[r.ProductName] = { ProductName: r.ProductName, GrandTotal: 0 };
      }
      pivot[r.ProductName][r.stockistname] = r.Sales;
      pivot[r.ProductName].GrandTotal += r.Sales;
    });

    res.json({ results: Object.values(pivot) });
  } catch (err) {
    console.error('Error /getTable2:', err);
    res.status(500).json({ error: 'Database error' });
  }
});




// ---------- Start server ----------
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
