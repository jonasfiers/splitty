require('dotenv').config({path: '../.env'});
const neo4j = require('neo4j-driver');

if (!process.env.NEO4J_PASSWORD) {
    console.error('Fatal: NEO4J_PASSWORD is not set');
    process.exit(1);
}

const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
        process.env.NEO4J_USER || 'neo4j',
        process.env.NEO4J_PASSWORD
    )
);

(async () => {
    try {
        const serverInfo = await driver.getServerInfo();
        console.log('Connection established to Neo4j');
        console.log(serverInfo);
    } catch (err) {
        console.error('Warning: Could not connect to Neo4j on startup:', err.message);
    }
})();

module.exports = driver;