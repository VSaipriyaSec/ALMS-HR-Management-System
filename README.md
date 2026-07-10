# 🚀 ALMS - Attendance & Leave Management System

A full-stack **Attendance and Leave Management System (ALMS)** developed to streamline employee attendance tracking, leave management, and administrative operations within an organization.

This project provides separate functionalities for **Admin** and **Employee** users with secure authentication, attendance tracking, leave requests, employee management, and reporting.

---

## 📌 Features

### 👨‍💼 Admin Module
- Secure Admin Login
- Dashboard Overview
- Add New Employees
- Employee Management
- Attendance Monitoring
- Holiday Management
- Leave Approval & Rejection
- Leave Balance Management
- Reports Generation
- Attendance Reports
- Leave Reports

### 👨‍💻 Employee Module
- Secure Employee Login
- Dashboard
- Clock In / Clock Out
- View Attendance
- Apply Leave
- View Leave Status
- View Holiday List
- Profile Management

---

## 🛠️ Tech Stack

### Frontend
- HTML5
- CSS3
- JavaScript

### Backend
- Node.js
- Express.js

### Database
- MySQL

### Tools
- Git
- GitHub
- VS Code

---

## 📂 Project Structure

```
ALMS-HR-Management-System
│
├── public/
│   ├── dashboard.html
│   ├── employee_list.html
│   ├── attendance.html
│   ├── holidays.html
│   ├── reports.html
│   ├── leave_master.html
│   ├── leave_applications.html
│   ├── add_employee.html
│   └── ...
│
├── app.js
├── server.js
├── db.js
├── package.json
├── package-lock.json
└── README.md
```

---

## ⚙️ Installation

### Clone Repository

```bash
git clone https://github.com/VSaipriyaSec/ALMS-HR-Management-System.git
```

### Navigate

```bash
cd ALMS-HR-Management-System
```

### Install Dependencies

```bash
npm install
```

### Configure Database

Create a MySQL database and import the required SQL tables.

Update your MySQL credentials inside

```
db.js
```

Example

```javascript
host: "localhost",
user: "root",
password: "your_password",
database: "hr_system"
```

### Start Server

```bash
node server.js
```

or

```bash
npm start
```

Server runs on

```
http://localhost:3000
```

---

## 🔑 Default Login Credentials

### Admin

| Employee ID | Password |
|-------------|----------|
| ADM1001 | adm1234 |

### Employee

| Employee ID | Password |
|-------------|----------|
| adm101 | default123 |
| adm102 | default123 |
| adm103 | default123 |
| adm104 | default123 |

*(Passwords can be changed through the database.)*

---

## 📊 Modules

- Authentication
- Dashboard
- Employee Management
- Attendance Management
- Leave Management
- Holiday Management
- Reports
- Leave Balance
- Input Validation
- Role-Based Access Control

---

## ✅ Validation Implemented

- Required Field Validation
- Employee ID Validation
- Name Validation
- Phone Number Validation
- Email Validation
- Date of Birth Validation
- Date of Joining Validation
- Minimum Age Validation
- Future Date Restriction

---

## 🔒 Security Features

- Role-Based Authentication
- Admin Access Control
- Employee Access Control
- Input Validation
- Protected Routes

---

## 🚀 Future Enhancements

- Password Encryption (bcrypt)
- Email Notifications
- Forgot Password
- JWT Authentication
- PDF Report Export
- Excel Report Export
- Profile Picture Upload
- Salary Management
- Payroll Module
- Mobile Responsive UI

---

## 📸 Screenshots

Add screenshots here after uploading images.

- Login Page
- Dashboard
- Employee Management
- Attendance
- Leave Management
- Reports

---

## 👩‍💻 Developed By

**V. Saipriya**

Final Year – B.E. Computer Science Engineering

GitHub:
https://github.com/VSaipriyaSec

LinkedIn:
(Add your LinkedIn URL)

---

## 📜 License

This project is developed for learning, academic, and portfolio purposes.
