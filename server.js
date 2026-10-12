const express = require("express");
const path = require("path");
const { sql, poolPromise } = require("./db");

const app = express();
const PORT = 3000;

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ==========================================
// HOME PAGE
// ==========================================

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ==========================================
// TEST API
// ==========================================

app.get("/api/status", (req, res) => {
    res.json({
        success: true,
        message: "Cyber Incident API is running",
        server: "Express",
        status: "online"
    });
});

// ==========================================
// DATABASE TEST
// ==========================================

app.get("/api/db-test", async (req, res) => {
    try {
        const pool = await poolPromise;

        const result = await pool.request().query(`
            SELECT
                DB_NAME() AS DatabaseName,
                GETDATE() AS ServerTime
        `);

        res.json({
            success: true,
            message: "Database connection successful",
            database: result.recordset[0].DatabaseName,
            serverTime: result.recordset[0].ServerTime
        });

    } catch (error) {
        console.error("Database test failed:");
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Database connection failed"
        });
    }
});

// ==========================================
// CREATE INCIDENT
// ==========================================

app.post("/api/incidents", async (req, res) => {
    try {
        const {
            title,
            type,
            severity,
            affectedSystem,
            reportedBy,
            description
        } = req.body;

        // Basic validation
        if (
            !title ||
            !type ||
            !severity ||
            !affectedSystem ||
            !reportedBy ||
            !description
        ) {
            return res.status(400).json({
                success: false,
                message: "All incident fields are required."
            });
        }

        const pool = await poolPromise;

        const result = await pool.request()
            .input("IncidentTitle", sql.NVarChar(200), title)
            .input("IncidentType", sql.NVarChar(100), type)
            .input("Severity", sql.NVarChar(20), severity)
            .input("AffectedSystem", sql.NVarChar(200), affectedSystem)
            .input("ReportedBy", sql.NVarChar(150), reportedBy)
            .input("Description", sql.NVarChar(sql.MAX), description)
            .query(`
                INSERT INTO Incidents
                (
                    IncidentTitle,
                    IncidentType,
                    Severity,
                    AffectedSystem,
                    ReportedBy,
                    Description
                )
                OUTPUT INSERTED.IncidentID
                VALUES
                (
                    @IncidentTitle,
                    @IncidentType,
                    @Severity,
                    @AffectedSystem,
                    @ReportedBy,
                    @Description
                );
            `);

        res.status(201).json({
            success: true,
            message: "Incident created successfully.",
            incidentId: result.recordset[0].IncidentID
        });

    } catch (error) {
        console.error("Error creating incident:");
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to create incident."
        });
    }
});

// ==========================================
// GET ALL INCIDENTS
// ==========================================

app.get("/api/incidents", async (req, res) => {
    try {
        const pool = await poolPromise;

        const result = await pool.request().query(`
            SELECT
                IncidentID,
                IncidentTitle,
                IncidentType,
                Severity,
                AffectedSystem,
                ReportedBy,
                Description,
                Status,
                DateReported
            FROM Incidents
            ORDER BY IncidentID DESC
        `);

        res.json({
            success: true,
            incidents: result.recordset
        });

    } catch (error) {
        console.error("Error retrieving incidents:");
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to retrieve incidents."
        });
    }
});

// ==========================================
// UPDATE INCIDENT STATUS
// ==========================================

app.put("/api/incidents/:id/status", async (req, res) => {
    try {
        const incidentId = parseInt(req.params.id);
        const { status } = req.body;

        if (isNaN(incidentId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid incident ID."
            });
        }

        const allowedStatuses = [
            "NEW",
            "UNDER INVESTIGATION",
            "CONTAINED",
            "RESOLVED"
        ];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid incident status."
            });
        }

        const pool = await poolPromise;

        const result = await pool.request()
            .input("IncidentID", sql.Int, incidentId)
            .input("Status", sql.NVarChar(50), status)
            .query(`
                UPDATE Incidents
                SET Status = @Status
                WHERE IncidentID = @IncidentID;
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                message: "Incident not found."
            });
        }

        res.json({
            success: true,
            message: "Incident status updated successfully."
        });

    } catch (error) {
        console.error("Error updating incident status:");
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Failed to update incident status."
        });
    }
});
// ============================================
// SOC DASHBOARD API
// ============================================

app.get("/api/dashboard/summary", async (req, res) => {
    try {
        const pool = await poolPromise;

        // 1. Main dashboard KPIs
        const kpiResult = await pool.request().query(`
            SELECT
                COUNT(*) AS totalIncidents,

                SUM(CASE
                    WHEN UPPER(LTRIM(RTRIM(Status)))
                         NOT IN ('RESOLVED', 'CLOSED')
                    THEN 1 ELSE 0
                END) AS openIncidents,

                SUM(CASE
                    WHEN UPPER(LTRIM(RTRIM(Severity)))
                         IN ('CRITICAL', 'HIGH')
                    AND UPPER(LTRIM(RTRIM(Status)))
                         NOT IN ('RESOLVED', 'CLOSED')
                    THEN 1 ELSE 0
                END) AS urgentOpenIncidents,

                SUM(CASE
                    WHEN UPPER(LTRIM(RTRIM(Status)))
                         IN ('RESOLVED', 'CLOSED')
                    THEN 1 ELSE 0
                END) AS resolvedIncidents,

                SUM(CASE
                    WHEN DateReported >= DATEADD(
                        HOUR, -24, GETDATE()
                    )
                    THEN 1 ELSE 0
                END) AS reportedLast24Hours

            FROM dbo.Incidents;
        `);

        // 2. Incidents grouped by severity
        const severityResult = await pool.request().query(`
            SELECT
                COALESCE(NULLIF(LTRIM(RTRIM(Severity)), ''), 'Unknown')
                    AS severity,
                COUNT(*) AS total
            FROM dbo.Incidents
            GROUP BY COALESCE(
                NULLIF(LTRIM(RTRIM(Severity)), ''),
                'Unknown'
            );
        `);

        // 3. Incidents grouped by status
        const statusResult = await pool.request().query(`
            SELECT
                COALESCE(NULLIF(LTRIM(RTRIM(Status)), ''), 'Unknown')
                    AS status,
                COUNT(*) AS total
            FROM dbo.Incidents
            GROUP BY COALESCE(
                NULLIF(LTRIM(RTRIM(Status)), ''),
                'Unknown'
            );
        `);

        // 4. Incident reporting trend for the last 7 days
        const trendResult = await pool.request().query(`
            SELECT
                CONVERT(VARCHAR(10), CONVERT(date, DateReported), 23)
                    AS reportDate,
                COUNT(*) AS total
            FROM dbo.Incidents
            WHERE DateReported >= DATEADD(
                DAY, -6, CONVERT(date, GETDATE())
            )
            AND DateReported < DATEADD(
                DAY, 1, CONVERT(date, GETDATE())
            )
            GROUP BY CONVERT(date, DateReported)
            ORDER BY CONVERT(date, DateReported);
        `);

        // 5. Most recently reported incidents
        const recentResult = await pool.request().query(`
            SELECT TOP (8)
                IncidentID,
                IncidentTitle,
                IncidentType,
                Severity,
                AffectedSystem,
                ReportedBy,
                Status,
                DateReported
            FROM dbo.Incidents
            ORDER BY DateReported DESC, IncidentID DESC;
        `);

        const k = kpiResult.recordset[0];

        res.json({
            success: true,

            kpis: {
                totalIncidents: Number(k.totalIncidents || 0),
                openIncidents: Number(k.openIncidents || 0),
                urgentOpenIncidents:
                    Number(k.urgentOpenIncidents || 0),
                resolvedIncidents: Number(k.resolvedIncidents || 0),
                reportedLast24Hours:
                    Number(k.reportedLast24Hours || 0)
            },

            severity: severityResult.recordset,
            statuses: statusResult.recordset,
            trend: trendResult.recordset,
            recentIncidents: recentResult.recordset,
            generatedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error("SOC dashboard error:", error.message);

        res.status(500).json({
            success: false,
            message: "Unable to load SOC dashboard data."
        });
    }
});


app.get("/api/dashboard/summary", async (req, res) => {
    try {
        const pool = await poolPromise;

        const result = await pool.request().query(`
            SELECT
                COUNT(*) AS totalIncidents,

                SUM(CASE
                    WHEN Status NOT IN ('RESOLVED', 'CLOSED')
                    THEN 1 ELSE 0
                END) AS openIncidents,

                SUM(CASE
                    WHEN Severity IN ('Critical', 'High')
                    AND Status NOT IN ('RESOLVED', 'CLOSED')
                    THEN 1 ELSE 0
                END) AS urgentOpenIncidents,

                SUM(CASE
                    WHEN Status IN ('RESOLVED', 'CLOSED')
                    THEN 1 ELSE 0
                END) AS resolvedIncidents,

                SUM(CASE
                    WHEN DateReported >= DATEADD(HOUR, -24, GETDATE())
                    THEN 1 ELSE 0
                END) AS reportedLast24Hours
            FROM dbo.Incidents;

            SELECT
                CONVERT(varchar(10), CONVERT(date, DateReported), 23)
                    AS reportDate,
                COUNT(*) AS total
            FROM dbo.Incidents
            WHERE DateReported >= DATEADD(DAY, -6, CONVERT(date, GETDATE()))
            GROUP BY CONVERT(date, DateReported)
            ORDER BY CONVERT(date, DateReported);

            SELECT Severity AS severity, COUNT(*) AS total
            FROM dbo.Incidents
            GROUP BY Severity;

            SELECT Status AS status, COUNT(*) AS total
            FROM dbo.Incidents
            GROUP BY Status;

            SELECT TOP 10
                IncidentID, IncidentTitle, IncidentType, Severity,
                AffectedSystem, Status, DateReported
            FROM dbo.Incidents
            ORDER BY DateReported DESC;
        `);

        const sets = result.recordsets;

        res.json({
            success: true,
            kpis: sets[0][0],
            trend: sets[1],
            severity: sets[2],
            statuses: sets[3],
            recentIncidents: sets[4]
        });

    } catch (error) {
        console.error("Dashboard summary error:", error.message);
        res.status(500).json({
            success: false,
            message: "Could not load dashboard summary."
        });
    }
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});