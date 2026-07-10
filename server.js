// server.js
const express = require("express");
const path = require("path");
const mysql = require("mysql2");
const cors = require("cors");


const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- MySQL connection (POOL instead of single connection - Fix #6) ---
const db = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "Root@123",
    database: "hr_system",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test the pool once at startup and create notifications table
db.query("SELECT 1", (err) => {
    if (err) {
        console.error("MySQL connection failed:", err.message);
        process.exit(1);
    }
    console.log("✅ Connected to MySQL (hr_system)");

    const createNotificationsTable = `
        CREATE TABLE IF NOT EXISTS notifications (
            id INT PRIMARY KEY AUTO_INCREMENT,
            emp_id VARCHAR(50) NOT NULL,
            title VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            type VARCHAR(50) DEFAULT 'info',
            is_read TINYINT DEFAULT 0,
            related_module VARCHAR(100),
            related_id INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_emp_id (emp_id),
            INDEX idx_is_read (is_read)
        )
    `;

    db.query(createNotificationsTable, (err) => {
        if (err) {
            console.error("❌ Failed to create notifications table:", err);
        } else {
            console.log("✅ Notifications table ready");
        }
    });
});

// ================= HELPER: TODAY'S DATE (Fix #5) =================
// toISOString() converts to UTC, so around midnight IST it can return
// the wrong (previous) day. This helper always returns local date.
function getTodayDate() {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

// ================= NOTIFICATION SYSTEM =================
const createNotification = (empId, title, message, type = 'info', relatedModule = null, relatedId = null) => {
    const sql = `
        INSERT INTO notifications 
        (emp_id, title, message, type, is_read, related_module, related_id, created_at)
        VALUES (?, ?, ?, ?, 0, ?, ?, CURRENT_TIMESTAMP)
    `;

    db.query(sql, [empId, title, message, type, relatedModule, relatedId], (err) => {
        if (err) {
            console.error("❌ Notification creation failed:", err);
        } else {
            console.log("✅ Notification created for EmpId:", empId, "- Title:", title);
        }
    });
};

// ================= ROUTES =================

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/test", (req, res) => {
    res.json({ message: "API is working!" });
});

// ================= LOGIN (Fix #8: bcrypt) =================
app.post("/api/login", (req, res) => {
    let { empid, password } = req.body;
    if (!empid || !password) return res.status(400).json({ message: "EmpId and password required" });

    empid = empid.trim();
    password = password.trim();

    const q = "SELECT EmpId, Name, Email, Role, Password FROM Users WHERE EmpId = ?";
    db.query(q, [empid], async (err, results) => {
        if (err) return res.status(500).json({ message: "DB error", error: err.message });
        if (results.length === 0) return res.status(401).json({ message: "Invalid EmpId or password" });

        const user = results[0];

        try {
            if (password !== user.Password) {
    return res.status(401).json({
        message: "Invalid EmpId or password"
    });
}

            res.json({
                message: "Login successful",
                EmpId: user.EmpId,
                Name: user.Name,
                Email: user.Email,
                role: user.Role
            });
        } catch (compareErr) {
            return res.status(500).json({ message: "Login error", error: compareErr.message });
        }
    });
});

// ================= EMPLOYEES =================
app.get("/api/employees", (req, res) => {
    const q = "SELECT EmpId, Name, Dept, Design, DOB, DOJ, Phone, Email, Address, EmpType, Active FROM employees";
    db.query(q, (err, results) => {
        if (err) return res.status(500).json({ message: "DB error", error: err.message });
        res.json(results);
    });
});

app.get("/api/employees/search", (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);
    const search = `%${q}%`;
    const sql = `SELECT EmpId, Name, Dept, Design, Email, Active FROM employees
               WHERE EmpId LIKE ? OR Name LIKE ? OR Dept LIKE ? OR Email LIKE ?`;
    db.query(sql, [search, search, search, search], (err, results) => {
        if (err) return res.status(500).json({ message: "DB error", error: err.message });
        res.json(results);
    });
});

// Fix #7 (INSERT ... ON DUPLICATE KEY UPDATE) + Fix #8 (bcrypt hashing)
app.post("/api/employees", async (req, res) => {
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
        return res.status(400).json({ message: "EmpId, Name, Dept and Design are required" });
    }

    const hashedPassword = Password;

    db.getConnection((connErr, connection) => {
        if (connErr) return res.status(500).json({ message: "DB error", error: connErr.message });

        connection.beginTransaction(err => {
            if (err) {
                connection.release();
                return res.status(500).json({ message: "DB error", error: err.message });
            }

            const insertEmp = `INSERT INTO employees
              (EmpId, Name, Dept, Design, DOB, DOJ, Phone, Email, Address, EmpType, Active, Password)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

            connection.query(insertEmp, [EmpId, Name, Dept, Design, DOB, DOJ, Phone, Email, Address, EmpType, Active, hashedPassword], (err) => {
                if (err) {
                    return connection.rollback(() => {
                        connection.release();
                        res.status(500).json({ message: "Insert employee failed", error: err.message });
                    });
                }

                const insertUser = `INSERT INTO Users (EmpId, Name, Email, Password, Role) 
                                     VALUES (?, ?, ?, ?, 'employee')
                                     ON DUPLICATE KEY UPDATE 
                                     Name = VALUES(Name), Email = VALUES(Email)`;

                connection.query(insertUser, [EmpId, Name, Email, hashedPassword], (err2) => {
                    if (err2) {
                        return connection.rollback(() => {
                            connection.release();
                            res.status(500).json({ message: "Insert user failed", error: err2.message });
                        });
                    }

                    connection.commit(errCommit => {
                        if (errCommit) {
                            return connection.rollback(() => {
                                connection.release();
                                res.status(500).json({ message: "Commit failed", error: errCommit.message });
                            });
                        }
                        connection.release();
                        res.json({ message: "Employee added successfully", EmpId });
                    });
                });
            });
        });
    });
});

// ================= ATTENDANCE =================
app.post("/api/clockin", (req, res) => {
    let { EmpId } = req.body;
    if (!EmpId) return res.status(400).json({ message: "EmpId required" });

    EmpId = EmpId.trim();
    const now = new Date();
    const date = getTodayDate();
    const time = now.toTimeString().slice(0, 8);

    const check = "SELECT * FROM attendance WHERE EmpId = ? AND AttendanceDate = ? ORDER BY SignIn DESC LIMIT 1";
    db.query(check, [EmpId, date], (err, rows) => {
        if (err) return res.status(500).json({ message: "DB error", error: err.message });

        if (rows.length > 0 && !rows[0].SignOut) {
            return res.status(400).json({ message: "You must clock out before clocking in again" });
        }

        const ins = "INSERT INTO attendance (EmpId, AttendanceDate, SignIn) VALUES (?, ?, ?)";
        db.query(ins, [EmpId, date, time], (err2) => {
            if (err2) return res.status(500).json({ message: "Insert failed", error: err2.message });
            res.json({ message: "Clocked in", time });
        });
    });
});

app.post("/api/clockout", (req, res) => {
    let { EmpId } = req.body;
    if (!EmpId) return res.status(400).json({ message: "EmpId required" });

    EmpId = EmpId.trim();
    const now = new Date();
    const date = getTodayDate();
    const time = now.toTimeString().slice(0, 8);

    const getSignIn = "SELECT * FROM attendance WHERE EmpId = ? AND AttendanceDate = ? AND SignOut IS NULL ORDER BY SignIn DESC LIMIT 1";
    db.query(getSignIn, [EmpId, date], (err, rows) => {
        if (err) return res.status(500).json({ message: "DB error", error: err.message });
        if (rows.length === 0) return res.status(400).json({ message: "Please clock in first" });

        const signIn = rows[0].SignIn;
        const workHrs = signIn ? ((new Date(`1970-01-01T${time}`) - new Date(`1970-01-01T${signIn}`)) / 1000 / 3600) : 0;

        const update = "UPDATE attendance SET SignOut = ?, WorkHrs = ? WHERE EmpId = ? AND AttendanceDate = ? AND SignIn = ?";
        db.query(update, [time, workHrs.toFixed(2), EmpId, date, signIn], (err2) => {
            if (err2) return res.status(500).json({ message: "Update failed", error: err2.message });
            res.json({ message: "Clocked out", time, hoursWorked: workHrs.toFixed(2) });
        });
    });
});

app.get("/api/summary/:EmpId", (req, res) => {
    let EmpId = req.params.EmpId;
    if (!EmpId) return res.status(400).json({ message: "EmpId required" });
    EmpId = EmpId.trim();
    const date = getTodayDate();

    const q = "SELECT SignIn, SignOut, WorkHrs FROM attendance WHERE EmpId = ? AND AttendanceDate = ? ORDER BY Id ASC";
    db.query(q, [EmpId, date], (err, rows) => {
        if (err) return res.status(500).json({ message: "DB error", error: err.message });

        if (rows.length === 0) {
            return res.json({
                lastIn: "--:--",
                lastOut: "--:--",
                hoursWorked: 0,
                logs: []
            });
        }

        const totalHours = rows.reduce((sum, r) => sum + Number(r.WorkHrs || 0), 0);

        res.json({
            lastIn: rows[rows.length - 1].SignIn || "--:--",
            lastOut: rows[rows.length - 1].SignOut || "--:--",
            hoursWorked: totalHours.toFixed(2),
            logs: rows
        });
    });
});

// ================= HOLIDAYS =================
app.get("/api/holidays", (req, res) => {
    const query = "SELECT id AS Id, year, date, holiday_name FROM holidays ORDER BY date ASC";
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ message: "Database error", error: err.message });
        res.json(results);
    });
});

app.post("/api/holidays", (req, res) => {
    const { year, date, holiday_name } = req.body;
    if (!year || !date || !holiday_name) return res.status(400).json({ message: "All fields are required" });

    const query = "INSERT INTO holidays (year, date, holiday_name) VALUES (?, ?, ?)";
    db.query(query, [year, date, holiday_name], (err) => {
        if (err) {
            if (err.code === "ER_DUP_ENTRY") {
                return res.status(400).json({ message: "Holiday already exists for this date" });
            }
            return res.status(500).json({ message: "DB error", error: err.message });
        }
        res.json({ message: "Holiday added successfully!" });
    });
});

app.put("/api/holidays/:id", (req, res) => {
    const { id } = req.params;
    const { year, date, holiday_name } = req.body;
    const query = "UPDATE holidays SET year=?, date=?, holiday_name=? WHERE id=?";
    db.query(query, [year, date, holiday_name, id], (err) => {
        if (err) return res.status(500).json({ message: "Update failed", error: err.message });
        res.json({ message: "Holiday updated successfully" });
    });
});

app.delete("/api/holidays/:id", (req, res) => {
    const { id } = req.params;
    const query = "DELETE FROM holidays WHERE id=?";
    db.query(query, [id], (err) => {
        if (err) return res.status(500).json({ message: "Delete failed", error: err.message });
        res.json({ message: "Holiday deleted successfully" });
    });
});

// ================= LEAVES =================
app.get("/api/leaves", (req, res) => {
    const sql = `
    SELECT 
      l.leave_id as Id,
      l.EmpId,
      e.Name as employeeName,
      l.leave_type as leaveType,
      l.start_date,
      l.end_date,
      l.number_of_days as numDays,
      l.reason,
      l.status
    FROM leaves l
    LEFT JOIN employees e ON l.EmpId = e.EmpId
    ORDER BY l.created_at DESC
  `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("❌ SQL Error (fetch leaves):", err.sqlMessage || err);
            return res.status(500).json({ message: "Failed to load leaves" });
        }
        res.json(results);
    });
});

// --- Apply Leave Route ---
app.post("/api/leaves", (req, res) => {
    console.log("📥 Received leave application request:", req.body);

    const {
        EmpId,
        leave_type_id,
        start_date,
        end_date,
        number_of_days,
        reason,
        away_from_hq
    } = req.body;

    if (!EmpId || !leave_type_id || !start_date || !end_date || !number_of_days || !reason) {
        console.log("❌ Missing required fields");
        return res.status(400).json({ message: "Please fill all required fields." });
    }

    const checkOverlapQuery = `
        SELECT leave_id 
        FROM leaves 
        WHERE EmpId = ? 
        AND status IN ('Pending', 'Approved')
        AND (
            (start_date BETWEEN ? AND ?) 
            OR (end_date BETWEEN ? AND ?)
            OR (? BETWEEN start_date AND end_date)
            OR (? BETWEEN start_date AND end_date)
        )
    `;

    db.query(checkOverlapQuery, [EmpId, start_date, end_date, start_date, end_date, start_date, end_date], (checkErr, checkResults) => {
        if (checkErr) {
            console.error("❌ SQL Error (check overlap):", checkErr);
            return res.status(500).json({ message: "Database error while checking leave dates" });
        }

        if (checkResults.length > 0) {
            console.log("❌ Leave application overlaps with existing leaves");
            return res.status(400).json({
                message: "You already have a pending or approved leave for these dates. Please check your existing leave applications."
            });
        }

        const awayFromHQValue = away_from_hq ? 1 : 0;

        const sql = `
            INSERT INTO leaves 
            (EmpId, leave_type, start_date, end_date, number_of_days, reason, away_from_hq, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')
        `;

        db.query(
            sql,
            [EmpId, leave_type_id, start_date, end_date, number_of_days, reason, awayFromHQValue],
            (err, result) => {
                if (err) {
                    console.error("❌ SQL Error:", err.sqlMessage || err);
                    return res.status(500).json({ message: "Failed to apply leave" });
                }

                console.log("✅ Leave applied successfully, ID:", result.insertId);

                // 1. Notify the employee who applied
                createNotification(
                    EmpId,
                    'Leave Application Submitted',
                    `Your ${leave_type_id} leave application for ${number_of_days} days has been submitted and is pending approval.`,
                    'success',
                    'leaves',
                    result.insertId
                );

                // 2. Notify all admins (Fix #2: Role lives in Users table, not employees)
                db.query(`SELECT EmpId FROM Users WHERE Role = 'admin'`, [], (adminErr, admins) => {
                    if (adminErr) {
                        console.error("❌ Failed to fetch admins:", adminErr);
                    } else if (admins.length > 0) {
                        admins.forEach(admin => {
                            createNotification(
                                admin.EmpId,
                                'New Leave Application',
                                `Employee ${EmpId} has applied for ${number_of_days} days of ${leave_type_id}. Please review.`,
                                'info',
                                'leaves',
                                result.insertId
                            );
                        });
                        console.log(`✅ Notifications sent to ${admins.length} admin(s)`);
                    } else {
                        console.log("⚠️ No admins found to notify");
                    }
                });

                res.json({ message: "Leave applied successfully! Waiting for approval." });
            }
        );
    });
});

// Update leave status with notifications
app.post("/api/leaves/:id/status", (req, res) => {
    const leaveId = req.params.id;
    const { status, comments, approvedBy } = req.body;

    if (!approvedBy) {
        return res.status(400).json({ error: "Approver information is required" });
    }

    const query = `UPDATE leaves SET status = ? WHERE leave_id = ?`;
    db.query(query, [status, leaveId], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: "Database error while updating leave status" });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Leave not found" });
        }

        db.query(`SELECT EmpId, leave_type, number_of_days FROM leaves WHERE leave_id = ?`, [leaveId], (err, leaveResults) => {
            if (err) {
                console.error("Failed to fetch leave details for notification:", err);
            } else if (leaveResults.length > 0) {
                const leave = leaveResults[0];

                createNotification(
                    leave.EmpId,
                    `Leave Application ${status}`,
                    `Your ${leave.leave_type} leave application for ${leave.number_of_days} days has been ${status.toLowerCase()}. ${comments || ''}`,
                    status === 'Approved' ? 'success' : 'warning',
                    'leaves',
                    leaveId
                );

                console.log(`✅ Status notification sent to employee ${leave.EmpId}`);
            }
        });

        res.json({ message: `Leave ${status} successfully` });
    });
});

// Fix #9: notify employee here too, since this route also changes leave status
app.put('/api/leaves/:id', (req, res) => {
    const leaveId = req.params.id;
    const { status, role } = req.body;

    if (role !== 'admin') {
        return res.status(403).json({ error: "Only admin can approve/reject leave" });
    }

    const query = `UPDATE leaves 
                 SET status = ?
                 WHERE leave_id = ?`;
    db.query(query, [status, leaveId], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: "Database error while updating leave status" });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Leave not found" });
        }

        db.query(`SELECT EmpId, leave_type, number_of_days FROM leaves WHERE leave_id = ?`, [leaveId], (err2, leaveResults) => {
            if (err2) {
                console.error("Failed to fetch leave details for notification:", err2);
            } else if (leaveResults.length > 0) {
                const leave = leaveResults[0];
                createNotification(
                    leave.EmpId,
                    `Leave Application ${status}`,
                    `Your ${leave.leave_type} leave application for ${leave.number_of_days} days has been ${status.toLowerCase()}.`,
                    status === 'Approved' ? 'success' : 'warning',
                    'leaves',
                    leaveId
                );
            }
        });

        res.json({ message: `Leave ${status} successfully` });
    });
});

// ================= LEAVE MASTER ROUTES =================
app.get("/api/leave_master", (req, res) => {
    const role = req.query.role || 'employee';
    const empId = (req.query.EmpId || '').trim();

    let sql = `
        SELECT lm.*, lt.leave_name 
        FROM leave_master lm 
        LEFT JOIN leave_types lt ON lm.leave_code = lt.leave_code
    `;
    let params = [];

    if (role !== 'admin') {
        sql += " WHERE lm.EmpId = ?";
        params.push(empId);
    }

    sql += " ORDER BY lm.EmpId, lm.leave_code";

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error("❌ SQL Error (fetch leave master):", err);
            return res.status(500).json({
                message: "Failed to fetch leave master data",
                error: err.message
            });
        }
        res.json(results || []);
    });
});

app.post("/api/leave_master", (req, res) => {
    const { EmpId, leave_type_id, leave_desc, balance } = req.body;

    if (!EmpId || !leave_type_id || balance === undefined) {
        return res.status(400).json({ message: "All fields are required" });
    }

    const leaveCodeMap = {
        1: 'CL',
        2: 'EL',
        3: 'HL'
    };

    const leave_code = leaveCodeMap[leave_type_id] || leave_type_id;

    const sql = `
        INSERT INTO leave_master (EmpId, leave_code, leave_desc, balance)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
        balance = VALUES(balance), 
        leave_desc = VALUES(leave_desc),
        updated_at = CURRENT_TIMESTAMP
    `;

    db.query(sql, [EmpId, leave_code, leave_desc, parseFloat(balance)], (err, result) => {
        if (err) {
            console.error("❌ SQL Error (save leave master):", err);
            return res.status(500).json({
                message: "Failed to save leave balance",
                error: err.message
            });
        }
        res.json({
            message: "Leave balance saved successfully",
            affectedRows: result.affectedRows
        });
    });
});

// ================= REPORTS =================
app.get("/reports", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "reports.html"));
});

app.get("/api/employee-report", (req, res) => {
    const sql = "SELECT EmpId, Name, Dept, Design, Active FROM employees";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) {
            return res.json({ message: "No data found" });
        }
        res.json(results);
    });
});

app.get('/api/leave-summary', (req, res) => {
    const { empId, startDate, endDate } = req.query;

    let sql = `
    SELECT 
        l.leave_id as Id,
        l.EmpId,
        e.Name AS employeeName,
        l.leave_type as leaveType,
        l.start_date,
        l.end_date,
        l.number_of_days as numDays,
        l.status
    FROM leaves l
    JOIN employees e ON l.EmpId = e.EmpId
    WHERE 1=1
  `;

    const params = [];
    if (empId && empId !== "All Employees") {
        sql += " AND l.EmpId = ?";
        params.push(empId);
    }
    if (startDate) {
        sql += " AND l.start_date >= ?";
        params.push(startDate);
    }
    if (endDate) {
        sql += " AND l.end_date <= ?";
        params.push(endDate);
    }

    sql += " ORDER BY l.start_date DESC";

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error("Leave summary error:", err);
            return res.status(500).json({ error: err.message });
        }
        res.json(results || []);
    });
});

// Fix #3 (leave_code, not leave_name) + Fix #4 (SUM, not COUNT)
app.get("/api/employee-leave-balance", (req, res) => {
    const { empId } = req.query;

    if (!empId) {
        return res.status(400).json({ message: "Employee ID is required" });
    }

    const sql = `
        SELECT 
            lm.leave_code,
            lt.leave_name,
            lm.balance as total_balance,
            COALESCE((
                SELECT SUM(number_of_days) 
                FROM leaves 
                WHERE EmpId = ? 
                AND leave_type = lt.leave_code 
                AND status = 'Approved'
                AND YEAR(start_date) = YEAR(CURDATE())
            ), 0) as leaves_used,
            (lm.balance - COALESCE((
                SELECT SUM(number_of_days) 
                FROM leaves 
                WHERE EmpId = ? 
                AND leave_type = lt.leave_code 
                AND status = 'Approved'
                AND YEAR(start_date) = YEAR(CURDATE())
            ), 0)) as available_balance
        FROM leave_master lm
        LEFT JOIN leave_types lt ON lm.leave_code = lt.leave_code
        WHERE lm.EmpId = ? AND lm.balance > 0
        ORDER BY lm.leave_code
    `;

    db.query(sql, [empId, empId, empId], (err, results) => {
        if (err) {
            console.error("❌ SQL Error (employee leave balance):", err);
            return res.status(500).json({
                message: "Failed to fetch leave balance",
                error: err.message
            });
        }
        res.json(results);
    });
});

app.get("/api/attendance-reports", (req, res) => {
    const { startDate, endDate, empId, department } = req.query;

    let sql = `
        SELECT 
            a.EmpId,
            e.Name,
            e.Dept,
            a.AttendanceDate,
            a.SignIn,
            a.SignOut,
            ROUND(GREATEST(TIME_TO_SEC(TIMEDIFF(a.SignIn, '09:30:00')) / 3600, 0), 2) AS LateHrs,
            ROUND(
                CASE
                    WHEN a.SignIn IS NULL OR a.SignOut IS NULL THEN 0
                    WHEN a.SignOut < a.SignIn THEN 
                        TIME_TO_SEC(TIMEDIFF(ADDTIME(a.SignOut, '24:00:00'), a.SignIn)) / 3600
                    ELSE TIME_TO_SEC(TIMEDIFF(a.SignOut, a.SignIn)) / 3600
                END,
            2) AS WorkHrs,
            a.Remarks,
            h.id AS HolidayId,
            h.holiday_name,
            CASE
                WHEN DAYOFWEEK(a.AttendanceDate) = 1 THEN 'Sunday'
                WHEN h.id IS NOT NULL THEN 'Holiday'
                ELSE 'Working Day'
            END AS DayType
        FROM Attendance a
        JOIN employees e ON a.EmpId = e.EmpId
        LEFT JOIN holidays h ON DATE(a.AttendanceDate) = DATE(h.date)
        WHERE a.AttendanceDate BETWEEN ? AND ?
    `;

    const params = [startDate, endDate];

    if (empId && empId !== "") {
        sql += " AND a.EmpId = ?";
        params.push(empId);
    }

    if (department && department !== "All Departments") {
        sql += " AND e.Dept = ?";
        params.push(department);
    }

    sql += " ORDER BY a.AttendanceDate ASC, a.EmpId ASC";

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error("SQL Error:", err);
            return res.status(500).json({ error: err.message });
        }

        const formatted = results.map(r => {
            const d = new Date(r.AttendanceDate);
            const formattedDate = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;

            let status = "Absent";
            let discrepancies = "-";

            if (r.DayType === "Sunday" || r.DayType === "Holiday") {
                status = r.DayType;
                discrepancies = "-";
            } else if (r.SignIn && r.SignIn !== '00:00:00') {
                if (r.LateHrs > 0) {
                    status = "Late";
                    discrepancies = "Late";
                } else {
                    status = "Present";
                    discrepancies = r.Remarks || "-";
                }
            }

            return {
                EmpId: r.EmpId,
                Name: r.Name,
                Department: r.Dept,
                Date: formattedDate,
                SignIn: r.SignIn,
                SignOut: r.SignOut,
                WorkedHours: r.WorkHrs,
                LateHours: r.LateHrs,
                Status: status,
                Discrepancies: discrepancies,
                DayType: r.DayType
            };
        });

        res.json(formatted);
    });
});

// ================= NOTIFICATION ROUTES (Fix #1: duplicates removed) =================

// Get notifications for employee
app.get("/api/notifications", (req, res) => {
    const { empId } = req.query;

    if (!empId) {
        return res.status(400).json({ message: "Employee ID is required" });
    }

    const sql = `
        SELECT id, emp_id, title, message, type, is_read, related_module, related_id, created_at
        FROM notifications 
        WHERE emp_id = ? 
        ORDER BY created_at DESC 
        LIMIT 50
    `;

    db.query(sql, [empId], (err, results) => {
        if (err) {
            console.error("❌ SQL Error (fetch notifications):", err);
            return res.status(500).json({ message: "Failed to fetch notifications" });
        }
        res.json(results || []);
    });
});

// Mark ONE notification as read (kept the safer version that also checks empId)
app.put("/api/notifications/:id/read", (req, res) => {
    const notificationId = req.params.id;
    const { empId } = req.body;

    if (!empId) {
        return res.status(400).json({ message: "Employee ID is required" });
    }

    const sql = "UPDATE notifications SET is_read = 1 WHERE id = ? AND emp_id = ?";

    db.query(sql, [notificationId, empId], (err, result) => {
        if (err) {
            console.error("❌ SQL Error (mark notification read):", err);
            return res.status(500).json({ message: "Failed to update notification" });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Notification not found" });
        }

        res.json({ message: "Notification marked as read" });
    });
});

// Mark all notifications as read for user
app.put("/api/notifications/mark-all-read", (req, res) => {
    const { empId } = req.body;

    if (!empId) {
        return res.status(400).json({ message: "Employee ID is required" });
    }

    const sql = "UPDATE notifications SET is_read = 1 WHERE emp_id = ? AND is_read = 0";

    db.query(sql, [empId], (err, result) => {
        if (err) {
            console.error("❌ SQL Error (mark all read):", err);
            return res.status(500).json({ message: "Failed to mark all as read" });
        }

        res.json({
            message: "All notifications marked as read",
            updatedCount: result.affectedRows
        });
    });
});

// Get unread notification count (kept only ONE copy)
app.get("/api/notifications/unread-count", (req, res) => {
    const { empId } = req.query;

    if (!empId) {
        return res.status(400).json({ message: "Employee ID is required" });
    }

    const sql = "SELECT COUNT(*) as unreadCount FROM notifications WHERE emp_id = ? AND is_read = 0";

    db.query(sql, [empId], (err, results) => {
        if (err) {
            console.error("❌ SQL Error (unread count):", err);
            return res.status(500).json({ message: "Failed to get unread count" });
        }
        res.json({ unreadCount: results[0].unreadCount });
    });
});

// ================= DASHBOARD API (Fix #10: merged, only ONE dashboard route) =================
app.get("/api/dashboard", (req, res) => {
    const empId = (req.query.empId || "").trim();
    const role = req.query.role || "employee";

    console.log("Dashboard API called - Role:", role, "EmpId:", empId);

    const data = {};

    db.query("SELECT COUNT(*) AS cnt FROM employees", (err, rows) => {
        if (err) return res.status(500).json({ message: "DB error", error: err.message });
        data.totalEmployees = rows[0].cnt;

        const today = getTodayDate();
        const holidayQuery = "SELECT COUNT(*) AS cnt FROM holidays WHERE date >= ? ORDER BY date ASC";

        db.query(holidayQuery, [today], (err, holidayRows) => {
            if (err) return res.status(500).json({ message: "DB error", error: err.message });
            data.upcomingHolidays = holidayRows[0].cnt;

            // Fix #3 (leave_code) + Fix #4 (SUM instead of COUNT).
            // Admin and employee use the same query shape here, so no need to duplicate it.
            const leaveBalanceQuery = `
                SELECT 
                    lm.leave_code,
                    lt.leave_name,
                    lm.balance as total_balance,
                    COALESCE((
                        SELECT SUM(number_of_days) 
                        FROM leaves 
                        WHERE EmpId = ? 
                        AND leave_type = lt.leave_code 
                        AND status = 'Approved'
                        AND YEAR(start_date) = YEAR(CURDATE())
                    ), 0) as leaves_taken,
                    lm.balance - COALESCE((
                        SELECT SUM(number_of_days) 
                        FROM leaves 
                        WHERE EmpId = ? 
                        AND leave_type = lt.leave_code 
                        AND status = 'Approved'
                        AND YEAR(start_date) = YEAR(CURDATE())
                    ), 0) as remaining_balance
                FROM leave_master lm
                LEFT JOIN leave_types lt ON lm.leave_code = lt.leave_code
                WHERE lm.EmpId = ? AND lm.balance > 0
                ORDER BY lm.leave_code
            `;
            const queryParams = [empId, empId, empId];

            db.query(leaveBalanceQuery, queryParams, (err, balanceRows) => {
                if (err) {
                    console.error("Error fetching leave balance:", err);
                    data.activeLeaves = 0;
                    data.leaveBreakdown = [];
                } else {
                    const totalBalance = balanceRows.reduce((sum, row) => sum + parseFloat(row.total_balance || 0), 0);
                    data.activeLeaves = totalBalance;
                    data.leaveBreakdown = balanceRows;
                }

                data.pendingTasks = ["Approve pending leaves"];
                data.systemNotifications = ["System maintenance"];

                res.json(data);
            });
        });
    });
});

// ================= START SERVER =================
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});