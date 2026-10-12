const sql = require("mssql");
require("dotenv").config();

const config = {
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT),
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,

    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
        console.log("Connected to SQL Server successfully.");
        return pool;
    })
    .catch(error => {
        console.error("SQL Server connection failed:");
        console.error(error);
    });

module.exports = {
    sql,
    poolPromise
};