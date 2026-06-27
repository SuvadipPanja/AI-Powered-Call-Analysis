const sql = require('mssql');

const config = {
    user: 'root',
    password: 'root@1234',
    server: "SUVADIP\\SQLEXPRESS",
    port: 1433, // Ensure TCP/IP protocol is set to this port
    database: 'call_analysis_db',
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

sql.connect(config)
    .then(() => console.log('Database connected successfully'))
    .catch(err => console.log('Database connection failed:', err));
