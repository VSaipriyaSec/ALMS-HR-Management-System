const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json()); // parse JSON bodies
app.use(express.static(path.join(__dirname, "public"))); // serve frontend files

// --- MySQL Connection ---
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "Root@123", // change if needed
    database: "hr_system"
});

db.connect(err => {
    if (err) {
        console.error("❌ DB connection failed:", err);
    } else {
        console.log("✅ Connected to MySQL database.");
    }
});

// --- Serve index.html ---
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- LOGIN (Admins + Employees) ---
app.post("/api/login", (req, res) => {
    const { empid, password } = req.body;

    if (!empid || !password) {
        return res.status(400).json({ message: "EmpId and password are required" });
    }

    // --- Check Admins ---
    const adminQuery = "SELECT * FROM admins WHERE LOWER(TRIM(AdminId)) = LOWER(TRIM(?)) AND Password = ?";
    db.query(adminQuery, [empid, password], (err, adminResults) => {
        if (err) return res.status(500).json({ message: "Database error", error: err.message });

        if (adminResults.length > 0) {
            return res.json({
                message: "Login successful",
                role: "admin",
                EmpId: adminResults[0].AdminId,
                Name: adminResults[0].Name || "Admin",
                token: ""
            });
        }

        // --- Check Employees ---
        const empQuery = "SELECT * FROM employees WHERE LOWER(TRIM(EmpId)) = LOWER(TRIM(?)) AND Password = ?";
        db.query(empQuery, [empid, password], (err, empResults) => {
            if (err) return res.status(500).json({ message: "Database error", error: err.message });

            if (empResults.length > 0) {
                const emp = empResults[0];
                return res.json({
                    message: "Login successful",
                    role: "employee",
                    EmpId: emp.EmpId,
                    Name: emp.Name,
                    Dept: emp.Dept,
                    Design: emp.Design,
                    token: ""
                });
            }

            return res.status(401).json({ message: "Invalid EmpId or password" });
        });
    });
});

// --- GET ALL EMPLOYEES ---
app.get("/api/employees", (req, res) => {
    const query = "SELECT EmpId, Name, Dept, Design, Active FROM employees";
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ message: "Database error", error: err.message });
        res.json(results);
    });
});

// --- SEARCH EMPLOYEES ---
app.get("/api/employees/search", (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);

    const search = `%${q}%`;
    const query = `
    SELECT EmpId, Name, Dept, Design, Active
    FROM employees
    WHERE EmpId LIKE ? OR Name LIKE ? OR Dept LIKE ? OR Email LIKE ?
  `;
    db.query(query, [search, search, search, search], (err, results) => {
        if (err) return res.status(500).json({ message: "Database error", error: err.message });
        res.json(results);
    });
});

// --- ADD NEW EMPLOYEE ---
app.post("/api/employees", (req, res) => {
    const {
        EmpId,
        Name,
        Dept,
        Design,
        DOB = null,
        DOJ = null,
        Phone = "",
        Email = "",
        Address = "",
        EmpType = "Permanent",
        Active = 1,
        Password = "1234"
    } = req.body;

    if (!EmpId || !Name || !Dept || !Design) {
        return res.status(400).json({ message: "EmpId, Name, Dept, and Design are required" });
    }

    const query = `
    INSERT INTO employees
    (EmpId, Name, Dept, Design, DOB, DOJ, Phone, Email, Address, EmpType, Active, Password)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

    db.query(
        query, [EmpId, Name, Dept, Design, DOB, DOJ, Phone, Email, Address, EmpType, Active, Password],
        (err, result) => {
            if (err) return res.status(500).json({ message: "Insert failed", error: err.sqlMessage });
            res.json({ message: "Employee added successfully", id: EmpId });
        }
    );
});

// ================= ATTENDANCE ROUTES =================

// Clock In
app.post("/api/clockin", (req, res) => {
    const { EmpId } = req.body;
    const time = new Date();
    const query = "INSERT INTO attendance (EmpId, clock_in) VALUES (?, ?)";

    db.query(query, [EmpId, time], (err) => {
        if (err) return res.status(500).json({ message: "DB error", error: err.message });
        res.json({ message: "Clocked in successfully", time: time.toLocaleTimeString() });
    });
});

// Clock Out
app.post("/api/clockout", (req, res) => {
    const { EmpId } = req.body;
    const time = new Date();
    const query = "UPDATE attendance SET clock_out=? WHERE EmpId=? AND DATE(clock_in)=CURDATE()";

    db.query(query, [time, EmpId], (err) => {
        if (err) return res.status(500).json({ message: "DB error", error: err.message });
        res.json({ message: "Clocked out successfully", time: time.toLocaleTimeString(), hoursWorked: 8 });
    });
});

// Daily Summary
app.get("/api/summary/:EmpId", (req, res) => {
    const { EmpId } = req.params;
    const query = "SELECT clock_in, clock_out FROM attendance WHERE EmpId=? AND DATE(clock_in)=CURDATE()";

    db.query(query, [EmpId], (err, rows) => {
        if (err) return res.status(500).json({ message: "DB error", error: err.message });
        if (rows.length === 0) return res.json({ lastIn: null, lastOut: null, hoursWorked: 0 });

        const row = rows[0];
        let hoursWorked = 0;
        if (row.clock_in && row.clock_out) {
            hoursWorked = (new Date(row.clock_out) - new Date(row.clock_in)) / 1000 / 60 / 60;
        }
        res.json({
            lastIn: row.clock_in ? new Date(row.clock_in).toLocaleTimeString() : null,
            lastOut: row.clock_out ? new Date(row.clock_out).toLocaleTimeString() : null,
            hoursWorked: hoursWorked.toFixed(2)
        });
    });
});

// ================= HOLIDAYS ROUTES =================

// GET ALL HOLIDAYS
app.get("/api/holidays", (req, res) => {
    const query = "SELECT * FROM holidays ORDER BY date ASC";
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ message: "Database error", error: err.message });
        res.json(results);
    });
});

// ADD NEW HOLIDAY
app.post("/api/holidays", (req, res) => {
    const { year, date, name } = req.body;

    if (!year || !date || !name) {
        return res.status(400).json({ message: "All fields are required" });
    }

    const query = "INSERT INTO holidays (year, date, name) VALUES (?, ?, ?)";
    db.query(query, [year, date, name], (err, result) => {
        if (err) return res.status(500).json({ message: "Insert failed", error: err.sqlMessage });
        res.json({ message: "Holiday added successfully!" });
    });
});

// --- Start server ---
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});