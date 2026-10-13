# Cybersecurity Incident Reporting System

A web-based application designed to help organizations report, manage, monitor, and track cybersecurity incidents through a centralized platform.

## 📌 About the Project

The **Cybersecurity Incident Reporting System** is a cybersecurity-focused web application developed to make incident reporting and monitoring more organized and accessible. It provides a central place for recording security incidents, tracking their severity and status, and supporting visibility into incident response activities.

The project combines a web-based user interface, a Node.js and Express backend, and Microsoft SQL Server for data storage.

It is also a practical project for exploring web development, database integration, cybersecurity operations, and Security Operations Center (SOC) workflows.

## 🎯 Project Objectives

- Centralize cybersecurity incident reporting and tracking.
- Record important incident details, including type, severity, affected systems, and status.
- Improve visibility into reported security incidents.
- Support incident monitoring through a dashboard.
- Store and retrieve incident records using a relational database.
- Provide a foundation for developing more advanced cybersecurity monitoring and incident response capabilities.

## ✨ Key Features

- **Incident Reporting:** Record cybersecurity incidents and relevant details.
- **Incident Management:** View and track incident records and their statuses.
- **SOC Dashboard:** Present incident-related information to support security monitoring.
- **Severity Classification:** Organize incidents by severity, such as Low, Medium, High, or Critical, where configured.
- **Database Integration:** Connect the application to Microsoft SQL Server.
- **API Integration:** Use backend API endpoints to exchange data between the frontend and server.
- **Notifications and Audit Logging:** Includes application components for notifications and audit-log functionality, subject to successful configuration.
- **Search and Filtering:** Help users locate incidents using available search and filtering controls.

*Note: The available features depend on the current implementation, database configuration, and user permissions.*

## 🛠️ Technologies Used

| Technology           | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| HTML5                | Webpage structure                                |
| CSS3                 | User interface styling                           |
| JavaScript           | Frontend interactivity                           |
| Node.js              | Server-side JavaScript runtime                   |
| Express.js           | Backend server and API routes                    |
| Microsoft SQL Server | Relational database                              |
| `mssql`              | Node.js SQL Server connectivity                  |
| dotenv               | Loading configuration from environment variables |
| Git and GitHub       | Version control and source-code management       |

## 🏗️ System Architecture

The application follows a basic client-server architecture.

```text
User
  |
  v
Web Interface
(HTML, CSS, JavaScript)
  |
  v
Express.js Backend
(Node.js and REST APIs)
  |
  v
Microsoft SQL Server
(CyberIncidentDB)
```

The frontend sends requests to the backend. The backend processes those requests and communicates with SQL Server to store or retrieve application data.

## 📂 Project Structure

The main project files include:

```text
CyberIncidentSystem2/
│
├── public/
│   ├── index.html
│   ├── script.js
│   ├── soc-dashboard.js
│   └── style.css
│
├── server.js
├── db.js
├── package.json
├── package-lock.json
├── .gitignore
├── .env.example
└── README.md
```

*Your actual repository may contain additional files or folders.*

## ⚙️ Getting Started

Follow these steps to run the application locally.

### 1. Prerequisites

Install the following tools:

- [Node.js](https://nodejs.org/)
- [Git](https://git-scm.com/)
- [Microsoft SQL Server](https://www.microsoft.com/en-us/sql-server)
- [SQL Server Management Studio (SSMS)](https://learn.microsoft.com/en-us/ssms/install/install)

You will also need access to a SQL Server instance and a database configured for the application.

### 2. Clone the Repository

Open PowerShell or a terminal and run:

```bash
git clone https://github.com/Awish-lab/Cybersecurity-Incident-Reporting-System.git
```

Navigate to the project directory:

```bash
cd Cybersecurity-Incident-Reporting-System
```

### 3. Install Dependencies

Run:

```bash
npm install
```

This installs the Node.js packages required by the application.

### 4. Configure Environment Variables

Create a local `.env` file in the project root. Use the `.env.example` file as a reference if it exists.

Example configuration:

```env
PORT=3000

DB_SERVER=localhost
DB_PORT=1433
DB_DATABASE=CyberIncidentDB
DB_USER=your_database_username
DB_PASSWORD=your_database_password

ADMIN_PASSWORD=replace_with_a_secure_admin_password
USER_PASSWORD=replace_with_a_secure_user_password
```

Replace the example values with your actual local configuration. Your SQL Server instance may use a different host, port, or authentication method.

**Important:** These are example settings, not verified production credentials or a guarantee that every variable matches the current application code. Check `server.js`, `db.js`, and `.env.example` for the variables your version actually requires.

Never commit your real `.env` file, database password, or other secrets to GitHub.

### 5. Configure the Database

1. Open SQL Server Management Studio.
2. Connect to your SQL Server instance.
3. Create or select the `CyberIncidentDB` database.
4. Ensure the required tables and columns exist.
5. Configure a database account with only the permissions the application needs.
6. Confirm that the server connection details match your environment variables.

The database schema must match the queries and models used by the backend.

### 6. Start the Application

Run the server:

```bash
node server.js
```

If the configuration is correct, the application should start on the configured port. For a local configuration using port `3000`, open:

[http://localhost:3000](http://localhost:3000)

If the page does not load, check the terminal output, environment variables, database connection, and server configuration.

## 🔐 Security Considerations

Because this application handles cybersecurity incident information, security is an important part of its development.

- Keep database credentials and authentication secrets out of source control.
- Use environment variables for sensitive configuration.
- Validate and sanitize user input on the server.
- Use parameterized SQL queries to help prevent SQL injection.
- Apply role-based access controls and least-privilege database permissions.
- Use HTTPS in production.
- Store passwords using an appropriate password-hashing algorithm rather than plaintext.
- Protect authenticated routes and session cookies.
- Log important security events without exposing passwords, tokens, or sensitive information.
- Review dependencies regularly and address security vulnerabilities.
- Back up the database and test recovery procedures.

These are recommended security practices; they should not be interpreted as confirmation that every control is already implemented.

## 🧪 Testing and Troubleshooting

When testing the application, verify that:

- The web interface loads successfully.
- The backend starts without errors.
- The application can connect to SQL Server.
- Incident records can be created, retrieved, and displayed correctly.
- Dashboard information matches the underlying database.
- Search, filtering, and status updates work as expected.
- Invalid requests and unauthorized access are handled appropriately.

Common problems include incorrect database credentials, an unavailable SQL Server instance, mismatched table names, expired sessions, and missing environment variables.

## 🚀 Deployment

The project can be prepared for deployment to a Node.js hosting platform, such as Render, provided the required configuration is completed.

Before deploying:

1. Configure the production start command.
2. Ensure the application listens on the port provided by the hosting platform.
3. Configure a securely hosted SQL Server database that the deployed application can reach.
4. Set environment variables in the hosting platform's dashboard.
5. Confirm that authentication, database connectivity, and API routes work in production.
6. Enable HTTPS and review production security settings.

**Important:** A SQL Server database running only on your personal computer is not automatically accessible to a cloud-hosted application. Production database connectivity must be configured separately.

## 🔮 Future Improvements

Potential improvements include:

- More detailed incident analytics and reporting.
- Email or other configurable incident notifications.
- Advanced role-based permissions.
- Incident assignment and response tracking.
- Integration with security monitoring tools.
- Exportable incident reports.
- Improved audit trails and dashboards.
- Automated security testing and deployment pipelines.

These are possible future enhancements, not necessarily completed features.

## 🎓 Learning Outcomes

This project provides practical experience in:

- Full-stack web application development.
- REST API design and backend development.
- Relational database integration using SQL Server.
- Cybersecurity incident management concepts.
- Troubleshooting application and database connectivity.
- Version control using Git and GitHub.
- Secure configuration and deployment practices.

## 👩‍💻 Author

**Daphney Ann**  
Computer Science Graduate | IT Support | Systems Administration | Cybersecurity Enthusiast

- **GitHub:** [Awish-lab](https://github.com/Awish-lab)
- **LinkedIn:** [Daphney Ann](https://www.linkedin.com/in/daphney-ann-a4310b239/)

## 📄 Disclaimer

This project is intended for educational, development, and authorized organizational use. It is not a replacement for a fully validated Security Information and Event Management (SIEM) platform or a complete incident response program.

Test the application in a controlled environment before using it with real organizational or sensitive incident data.
