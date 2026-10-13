const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { sql, poolPromise } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================================
// MIDDLEWARE
// =====================================================
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(
  express.static(path.join(__dirname, "public"), {
    index: false,
    etag: true
  })
);

// =====================================================
// AUTH
// =====================================================
const USERS = {
  admin: {
    password: process.env.ADMIN_PASSWORD || "Admin@2026",
    name: "Administrator",
    role: "admin"
  },
  user: {
    password: process.env.USER_PASSWORD || "User@2026",
    name: "Staff User",
    role: "user"
  }
};

if (!process.env.ADMIN_PASSWORD || !process.env.USER_PASSWORD) {
  console.warn(
    "WARNING: Demo password fallback enabled. " +
      "Set ADMIN_PASSWORD and USER_PASSWORD before production."
  );
}

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();

function safeEqual(a, b) {
  const hashA = crypto.createHash("sha256").update(String(a)).digest();
  const hashB = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function loginRateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 10;
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expires <= now) sessions.delete(token);
  }
  for (const [ip, attempt] of loginAttempts) {
    if (attempt.resetAt <= now) loginAttempts.delete(ip);
  }
}, 10 * 60 * 1000).unref();

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = token ? sessions.get(token) : null;

  if (!session || session.expires <= Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({
      success: false,
      message: "Your session has expired. Please sign in again."
    });
  }

  req.user = session;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Administrator access required."
    });
  }
  next();
}

// =====================================================
// AUDIT LOG HELPER
// =====================================================
async function writeAudit({
  actor,
  action,
  entityType = null,
  entityId = null,
  details = null,
  ip = null
}) {
  try {
    const pool = await poolPromise;
    await pool
      .request()
      .input("ActorUsername", sql.NVarChar(100), actor?.username || "unknown")
      .input("ActorName", sql.NVarChar(150), actor?.name || "Unknown")
      .input("ActorRole", sql.NVarChar(20), actor?.role || "unknown")
      .input("Action", sql.NVarChar(80), action)
      .input("EntityType", sql.NVarChar(50), entityType)
      .input("EntityID", sql.Int, entityId)
      .input("Details", sql.NVarChar(1000), details)
      .input("IPAddress", sql.NVarChar(45), ip)
      .query(`
        INSERT INTO dbo.AuditLogs
          (ActorUsername, ActorName, ActorRole, Action,
           EntityType, EntityID, Details, IPAddress)
        VALUES
          (@ActorUsername, @ActorName, @ActorRole, @Action,
           @EntityType, @EntityID, @Details, @IPAddress);
      `);
  } catch (err) {
    console.error("Audit log write failed:", err.message);
  }
}

function clientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    null
  );
}

// =====================================================
// AUTH ROUTES
// =====================================================
app.post("/api/auth/login", async (req, res) => {
  const ip = clientIp(req) || "unknown";

  if (loginRateLimited(ip)) {
    return res.status(429).json({
      success: false,
      message: "Too many login attempts. Try again in 15 minutes."
    });
  }

  const username = String(req.body?.username || "")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password || "");
  const account = Object.hasOwn(USERS, username) ? USERS[username] : null;
  const passwordOk = safeEqual(password, account ? account.password : "");

  if (!account || !passwordOk) {
    await writeAudit({
      actor: {
        username: username || "unknown",
        name: "Unknown",
        role: "unknown"
      },
      action: "LOGIN_FAILED",
      entityType: "Auth",
      details: `Failed login attempt for "${username || "(empty)"}"`,
      ip
    });
    return res.status(401).json({
      success: false,
      message: "Incorrect username or password."
    });
  }

  loginAttempts.delete(ip);

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    username,
    name: account.name,
    role: account.role,
    expires: Date.now() + SESSION_TTL_MS
  });

  await writeAudit({
    actor: { username, name: account.name, role: account.role },
    action: "LOGIN",
    entityType: "Auth",
    details: `User ${username} signed in`,
    ip
  });

  return res.json({
    success: true,
    token,
    user: {
      username,
      name: account.name,
      role: account.role
    }
  });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({
    success: true,
    user: {
      username: req.user.username,
      name: req.user.name,
      role: req.user.role
    }
  });
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  const token = req.headers.authorization.slice(7);
  sessions.delete(token);

  await writeAudit({
    actor: req.user,
    action: "LOGOUT",
    entityType: "Auth",
    details: `User ${req.user.username} signed out`,
    ip: clientIp(req)
  });

  res.json({ success: true, message: "Signed out successfully." });
});

// =====================================================
// HOME + STATUS
// =====================================================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    message: "Cyber Incident API is running",
    server: "Express",
    status: "online"
  });
});

app.get("/api/db-test", requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT DB_NAME() AS DatabaseName, GETDATE() AS ServerTime
    `);
    res.json({
      success: true,
      message: "Database connection successful",
      database: result.recordset[0].DatabaseName,
      serverTime: result.recordset[0].ServerTime
    });
  } catch (error) {
    console.error("Database test failed:", error);
    res.status(500).json({
      success: false,
      message: "Database connection failed."
    });
  }
});

// =====================================================
// CONSTANTS
// =====================================================
const ALLOWED_TYPES = [
  "Phishing",
  "Malware",
  "Unauthorized Access",
  "Data Breach",
  "Ransomware",
  "Network Attack",
  "Other"
];
const ALLOWED_SEVERITIES = ["Critical", "High", "Medium", "Low"];
const ALLOWED_STATUSES = [
  "NEW",
  "UNDER INVESTIGATION",
  "CONTAINED",
  "RESOLVED"
];

// Accepts only real YYYY-MM-DD dates, otherwise returns null
function parseDateParam(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const d = new Date(`${str}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return str;
}

// =====================================================
// CREATE INCIDENT
// =====================================================
app.post("/api/incidents", requireAuth, async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    const type = String(req.body?.type || "").trim();
    const severity = String(req.body?.severity || "").trim();
    const affectedSystem = String(req.body?.affectedSystem || "").trim();
    const description = String(req.body?.description || "").trim();
    const reportedBy =
      req.user.role === "admin"
        ? String(req.body?.reportedBy || req.user.name).trim()
        : req.user.name;

    if (!title || !type || !severity || !affectedSystem || !description) {
      return res.status(400).json({
        success: false,
        message:
          "Title, type, severity, affected system and description are required."
      });
    }
    if (!ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid incident type."
      });
    }
    if (!ALLOWED_SEVERITIES.includes(severity)) {
      return res.status(400).json({
        success: false,
        message: "Invalid incident severity."
      });
    }
    if (
      title.length > 200 ||
      affectedSystem.length > 200 ||
      reportedBy.length > 150 ||
      description.length > 10000
    ) {
      return res.status(400).json({
        success: false,
        message: "One or more fields exceed the allowed length."
      });
    }

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("IncidentTitle", sql.NVarChar(200), title)
      .input("IncidentType", sql.NVarChar(100), type)
      .input("Severity", sql.NVarChar(20), severity)
      .input("AffectedSystem", sql.NVarChar(200), affectedSystem)
      .input("ReportedBy", sql.NVarChar(150), reportedBy)
      .input("Description", sql.NVarChar(sql.MAX), description)
      .query(`
        INSERT INTO dbo.Incidents
        (
          IncidentTitle, IncidentType, Severity,
          AffectedSystem, ReportedBy, Description
        )
        OUTPUT INSERTED.IncidentID
        VALUES
        (
          @IncidentTitle, @IncidentType, @Severity,
          @AffectedSystem, @ReportedBy, @Description
        );
      `);

    const incidentId = result.recordset[0].IncidentID;

    await pool
      .request()
      .input("IncidentID", sql.Int, incidentId)
      .input("Author", sql.NVarChar(150), req.user.name)
      .input(
        "CommentText",
        sql.NVarChar(sql.MAX),
        `Incident reported (${severity}).`
      )
      .query(`
        INSERT INTO dbo.IncidentComments (IncidentID, Author, CommentText)
        VALUES (@IncidentID, @Author, @CommentText);
      `);

    if (severity === "Critical") {
      try {
        await pool
          .request()
          .input("Title", sql.NVarChar(200), "Critical incident reported")
          .input(
            "Body",
            sql.NVarChar(500),
            `${title} was reported by ${reportedBy}. Immediate attention required.`
          )
          .input("IncidentID", sql.Int, incidentId)
          .query(`
            INSERT INTO dbo.Notifications
              (RecipientRole, Title, Body, IncidentID)
            VALUES
              ('admin', @Title, @Body, @IncidentID);
          `);
      } catch (notifyErr) {
        console.error("Notification insert failed:", notifyErr.message);
      }
    }

    await writeAudit({
      actor: req.user,
      action: "CREATE_INCIDENT",
      entityType: "Incident",
      entityId: incidentId,
      details: `Created "${title}" (${severity})`,
      ip: clientIp(req)
    });

    return res.status(201).json({
      success: true,
      message: "Incident created successfully.",
      incidentId
    });
  } catch (error) {
    console.error("Error creating incident:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create incident."
    });
  }
});

// =====================================================
// GET INCIDENTS  (FIXED)
// =====================================================
app.get("/api/incidents", requireAuth, async (req, res) => {
  try {
    const pool = await poolPromise;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 25)
    );
    const offset = (page - 1) * limit;

    // Validate dates so values like "undefined" or "null" can't break the query
    const from = parseDateParam(req.query.from);
    const to = parseDateParam(req.query.to);

    const whereParts = [];
    const bindFilters = (request) => {
      if (req.user.role !== "admin") {
        request.input("ReportedBy", sql.NVarChar(150), req.user.name);
      }
      if (from) request.input("FromDate", sql.Date, from);
      if (to) request.input("ToDate", sql.Date, to);
    };

    if (req.user.role !== "admin") {
      whereParts.push("ReportedBy = @ReportedBy");
    }
    if (from) whereParts.push("CONVERT(date, DateReported) >= @FromDate");
    if (to) whereParts.push("CONVERT(date, DateReported) <= @ToDate");

    const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    // Total count (for pagination)
    const countReq = pool.request();
    bindFilters(countReq);
    const countResult = await countReq.query(`
      SELECT COUNT(*) AS total FROM dbo.Incidents ${where};
    `);
    const total = Number(countResult.recordset[0].total || 0);

    // Page of results
    const listReq = pool.request();
    bindFilters(listReq);
    listReq.input("Offset", sql.Int, offset);
    listReq.input("Limit", sql.Int, limit);

    const result = await listReq.query(`
      SELECT
        IncidentID,
        IncidentTitle,
        IncidentType,
        Severity,
        AffectedSystem,
        ReportedBy,
        Description,
        Status,
        DateReported,
        AssignedTo,
        AcknowledgedAt,
        ResolvedAt
      FROM dbo.Incidents
      ${where}
      ORDER BY IncidentID DESC
      OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
    `);

    res.json({
      success: true,
      incidents: result.recordset,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    });
  } catch (error) {
    console.error("Error retrieving incidents:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve incidents."
    });
  }
});

// =====================================================
// UPDATE STATUS (+ MTTA / MTTR timestamps)
// =====================================================
app.put(
  "/api/incidents/:id/status",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const incidentId = Number(req.params.id);
      const status = req.body?.status;

      if (!Number.isSafeInteger(incidentId) || incidentId < 1) {
        return res.status(400).json({
          success: false,
          message: "Invalid incident ID."
        });
      }
      if (!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid incident status."
        });
      }

      const pool = await poolPromise;

      const current = await pool
        .request()
        .input("IncidentID", sql.Int, incidentId)
        .query(`
          SELECT Status, AcknowledgedAt, ResolvedAt, DateReported
          FROM dbo.Incidents
          WHERE IncidentID = @IncidentID;
        `);

      if (!current.recordset.length) {
        return res.status(404).json({
          success: false,
          message: "Incident not found."
        });
      }

      const row = current.recordset[0];
      const now = new Date();
      const setAck =
        status === "UNDER INVESTIGATION" && !row.AcknowledgedAt;
      const setResolved = status === "RESOLVED" && !row.ResolvedAt;

      await pool
        .request()
        .input("IncidentID", sql.Int, incidentId)
        .input("Status", sql.NVarChar(50), status)
        .input(
          "AcknowledgedAt",
          sql.DateTime2,
          setAck ? now : row.AcknowledgedAt
        )
        .input(
          "ResolvedAt",
          sql.DateTime2,
          setResolved ? now : row.ResolvedAt
        )
        .query(`
          UPDATE dbo.Incidents
          SET
            Status = @Status,
            AcknowledgedAt = @AcknowledgedAt,
            ResolvedAt = @ResolvedAt
          WHERE IncidentID = @IncidentID;
        `);

      await pool
        .request()
        .input("IncidentID", sql.Int, incidentId)
        .input("Author", sql.NVarChar(150), req.user.name)
        .input(
          "CommentText",
          sql.NVarChar(sql.MAX),
          `Status changed to ${status}.`
        )
        .query(`
          INSERT INTO dbo.IncidentComments (IncidentID, Author, CommentText)
          VALUES (@IncidentID, @Author, @CommentText);
        `);

      await writeAudit({
        actor: req.user,
        action: "UPDATE_STATUS",
        entityType: "Incident",
        entityId: incidentId,
        details: `Status set to ${status}`,
        ip: clientIp(req)
      });

      res.json({
        success: true,
        message: "Incident status updated successfully."
      });
    } catch (error) {
      console.error("Error updating incident status:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update incident status."
      });
    }
  }
);

// =====================================================
// ASSIGN INVESTIGATOR
// =====================================================
app.put(
  "/api/incidents/:id/assign",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const incidentId = Number(req.params.id);
      const assignedTo = String(req.body?.assignedTo || "").trim();

      if (!Number.isSafeInteger(incidentId) || incidentId < 1) {
        return res.status(400).json({
          success: false,
          message: "Invalid incident ID."
        });
      }
      if (assignedTo.length > 150) {
        return res.status(400).json({
          success: false,
          message: "Assignee name too long."
        });
      }

      const pool = await poolPromise;
      const result = await pool
        .request()
        .input("IncidentID", sql.Int, incidentId)
        .input("AssignedTo", sql.NVarChar(150), assignedTo || null)
        .query(`
          UPDATE dbo.Incidents
          SET AssignedTo = @AssignedTo
          WHERE IncidentID = @IncidentID;
        `);

      if (result.rowsAffected[0] === 0) {
        return res.status(404).json({
          success: false,
          message: "Incident not found."
        });
      }

      await pool
        .request()
        .input("IncidentID", sql.Int, incidentId)
        .input("Author", sql.NVarChar(150), req.user.name)
        .input(
          "CommentText",
          sql.NVarChar(sql.MAX),
          assignedTo
            ? `Assigned to ${assignedTo}.`
            : "Investigator unassigned."
        )
        .query(`
          INSERT INTO dbo.IncidentComments (IncidentID, Author, CommentText)
          VALUES (@IncidentID, @Author, @CommentText);
        `);

      await writeAudit({
        actor: req.user,
        action: "ASSIGN_INCIDENT",
        entityType: "Incident",
        entityId: incidentId,
        details: assignedTo
          ? `Assigned to ${assignedTo}`
          : "Unassigned investigator",
        ip: clientIp(req)
      });

      res.json({ success: true, message: "Assignee updated." });
    } catch (error) {
      console.error("Assign error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update assignee."
      });
    }
  }
);

// =====================================================
// COMMENTS
// =====================================================
app.get("/api/incidents/:id/comments", requireAuth, async (req, res) => {
  try {
    const incidentId = Number(req.params.id);
    if (!Number.isSafeInteger(incidentId) || incidentId < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid incident ID."
      });
    }

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("IncidentID", sql.Int, incidentId)
      .query(`
        SELECT CommentID, IncidentID, Author, CommentText, CreatedAt
        FROM dbo.IncidentComments
        WHERE IncidentID = @IncidentID
        ORDER BY CreatedAt ASC;
      `);

    res.json({ success: true, comments: result.recordset });
  } catch (error) {
    console.error("Comments load error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to load comments."
    });
  }
});

app.post("/api/incidents/:id/comments", requireAuth, async (req, res) => {
  try {
    const incidentId = Number(req.params.id);
    const text = String(req.body?.comment || "").trim();

    if (!Number.isSafeInteger(incidentId) || incidentId < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid incident ID."
      });
    }
    if (!text || text.length > 5000) {
      return res.status(400).json({
        success: false,
        message: "Comment is required (max 5000 characters)."
      });
    }

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("IncidentID", sql.Int, incidentId)
      .input("Author", sql.NVarChar(150), req.user.name)
      .input("CommentText", sql.NVarChar(sql.MAX), text)
      .query(`
        INSERT INTO dbo.IncidentComments (IncidentID, Author, CommentText)
        OUTPUT INSERTED.CommentID, INSERTED.Author,
               INSERTED.CommentText, INSERTED.CreatedAt
        VALUES (@IncidentID, @Author, @CommentText);
      `);

    await writeAudit({
      actor: req.user,
      action: "ADD_COMMENT",
      entityType: "Incident",
      entityId: incidentId,
      details: text.slice(0, 200),
      ip: clientIp(req)
    });

    res.status(201).json({
      success: true,
      comment: result.recordset[0]
    });
  } catch (error) {
    console.error("Comment create error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add comment."
    });
  }
});

// =====================================================
// NOTIFICATIONS
// =====================================================
app.get("/api/notifications", requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT TOP (30)
        NotificationID, Title, Body, IncidentID, IsRead, CreatedAt
      FROM dbo.Notifications
      WHERE RecipientRole = 'admin'
      ORDER BY CreatedAt DESC;
    `);
    res.json({ success: true, notifications: result.recordset });
  } catch (error) {
    console.error("Notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to load notifications."
    });
  }
});

app.post(
  "/api/notifications/:id/read",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({
          success: false,
          message: "Invalid notification ID."
        });
      }

      const pool = await poolPromise;
      await pool
        .request()
        .input("NotificationID", sql.Int, id)
        .query(`
          UPDATE dbo.Notifications
          SET IsRead = 1
          WHERE NotificationID = @NotificationID;
        `);

      res.json({ success: true });
    } catch (error) {
      console.error("Mark read error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update notification."
      });
    }
  }
);

// =====================================================
// AUDIT LOGS
// =====================================================
app.get("/api/audit-logs", requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 50)
    );
    const offset = (page - 1) * limit;
    const action = req.query.action ? String(req.query.action).trim() : null;
    const search = req.query.q ? String(req.query.q).trim() : null;

    const whereParts = [];
    const bind = (request) => {
      if (action) request.input("Action", sql.NVarChar(80), action);
      if (search) request.input("Search", sql.NVarChar(200), `%${search}%`);
    };

    if (action) whereParts.push("Action = @Action");
    if (search) {
      whereParts.push(`(
        ActorUsername LIKE @Search OR
        ActorName LIKE @Search OR
        Details LIKE @Search OR
        CAST(EntityID AS NVARCHAR(20)) LIKE @Search
      )`);
    }
    const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const pool = await poolPromise;

    const countReq = pool.request();
    bind(countReq);
    const countResult = await countReq.query(`
      SELECT COUNT(*) AS total FROM dbo.AuditLogs ${where};
    `);
    const total = Number(countResult.recordset[0].total || 0);

    const listReq = pool.request();
    bind(listReq);
    listReq.input("Offset", sql.Int, offset);
    listReq.input("Limit", sql.Int, limit);

    const result = await listReq.query(`
      SELECT
        AuditID, ActorUsername, ActorName, ActorRole,
        Action, EntityType, EntityID, Details, IPAddress, CreatedAt
      FROM dbo.AuditLogs
      ${where}
      ORDER BY CreatedAt DESC, AuditID DESC
      OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
    `);

    res.json({
      success: true,
      logs: result.recordset,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    });
  } catch (error) {
    console.error("Audit logs error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to load audit logs."
    });
  }
});

// =====================================================
// SOC DASHBOARD (+ MTTA / MTTR)
// =====================================================
app.get(
  "/api/dashboard/summary",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const pool = await poolPromise;

      const kpiResult = await pool.request().query(`
        SELECT
          COUNT(*) AS totalIncidents,
          COALESCE(SUM(CASE
            WHEN UPPER(LTRIM(RTRIM(Status))) NOT IN ('RESOLVED', 'CLOSED')
            THEN 1 ELSE 0 END), 0) AS openIncidents,
          COALESCE(SUM(CASE
            WHEN UPPER(LTRIM(RTRIM(Severity))) IN ('CRITICAL', 'HIGH')
             AND UPPER(LTRIM(RTRIM(Status))) NOT IN ('RESOLVED', 'CLOSED')
            THEN 1 ELSE 0 END), 0) AS urgentOpenIncidents,
          COALESCE(SUM(CASE
            WHEN UPPER(LTRIM(RTRIM(Status))) IN ('RESOLVED', 'CLOSED')
            THEN 1 ELSE 0 END), 0) AS resolvedIncidents,
          COALESCE(SUM(CASE
            WHEN DateReported >= DATEADD(HOUR, -24, GETDATE())
            THEN 1 ELSE 0 END), 0) AS reportedLast24Hours
        FROM dbo.Incidents;
      `);

      const metricsResult = await pool.request().query(`
        SELECT
          AVG(
            CASE
              WHEN AcknowledgedAt IS NOT NULL
              THEN DATEDIFF(MINUTE, DateReported, AcknowledgedAt) / 60.0
            END
          ) AS avgAckHours,
          AVG(
            CASE
              WHEN ResolvedAt IS NOT NULL
              THEN DATEDIFF(MINUTE, DateReported, ResolvedAt) / 60.0
            END
          ) AS avgResolveHours,
          COUNT(CASE WHEN AcknowledgedAt IS NOT NULL THEN 1 END) AS ackSampleSize,
          COUNT(CASE WHEN ResolvedAt IS NOT NULL THEN 1 END) AS resolveSampleSize
        FROM dbo.Incidents;
      `);

      const severityResult = await pool.request().query(`
        SELECT
          COALESCE(NULLIF(LTRIM(RTRIM(Severity)), ''), 'Unknown') AS severity,
          COUNT(*) AS total
        FROM dbo.Incidents
        GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(Severity)), ''), 'Unknown');
      `);

      const statusResult = await pool.request().query(`
        SELECT
          COALESCE(NULLIF(LTRIM(RTRIM(Status)), ''), 'Unknown') AS status,
          COUNT(*) AS total
        FROM dbo.Incidents
        GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(Status)), ''), 'Unknown');
      `);

      const trendResult = await pool.request().query(`
        SELECT
          CONVERT(VARCHAR(10), CONVERT(date, DateReported), 23) AS reportDate,
          COUNT(*) AS total
        FROM dbo.Incidents
        WHERE DateReported >= DATEADD(DAY, -6, CONVERT(date, GETDATE()))
          AND DateReported <  DATEADD(DAY,  1, CONVERT(date, GETDATE()))
        GROUP BY CONVERT(date, DateReported)
        ORDER BY CONVERT(date, DateReported);
      `);

      const recentResult = await pool.request().query(`
        SELECT TOP (8)
          IncidentID, IncidentTitle, IncidentType, Severity,
          AffectedSystem, ReportedBy, Status, DateReported, AssignedTo,
          AcknowledgedAt, ResolvedAt
        FROM dbo.Incidents
        ORDER BY DateReported DESC, IncidentID DESC;
      `);

      const k = kpiResult.recordset[0];
      const m = metricsResult.recordset[0] || {};

      res.json({
        success: true,
        kpis: {
          totalIncidents: Number(k.totalIncidents || 0),
          openIncidents: Number(k.openIncidents || 0),
          urgentOpenIncidents: Number(k.urgentOpenIncidents || 0),
          resolvedIncidents: Number(k.resolvedIncidents || 0),
          reportedLast24Hours: Number(k.reportedLast24Hours || 0)
        },
        metrics: {
          mttaHours:
            m.avgAckHours != null
              ? Number(Number(m.avgAckHours).toFixed(1))
              : null,
          mttrHours:
            m.avgResolveHours != null
              ? Number(Number(m.avgResolveHours).toFixed(1))
              : null,
          mttaSampleSize: Number(m.ackSampleSize || 0),
          mttrSampleSize: Number(m.resolveSampleSize || 0)
        },
        severity: severityResult.recordset,
        statuses: statusResult.recordset,
        trend: trendResult.recordset,
        recentIncidents: recentResult.recordset,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("SOC dashboard error:", error);
      res.status(500).json({
        success: false,
        message: "Unable to load SOC dashboard data."
      });
    }
  }
);

// =====================================================
// FALLBACKS
// =====================================================
app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found."
  });
});

app.use((error, req, res, next) => {
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON in request body."
    });
  }
  console.error("Unhandled server error:", error);
  res.status(500).json({
    success: false,
    message: "Something went wrong."
  });
});

// =====================================================
// START
// =====================================================
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});