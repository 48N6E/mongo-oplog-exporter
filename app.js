const { MongoClient,Timestamp } = require('mongodb');
const express = require('express');
const bodyParser = require('body-parser');
const config = require('./utils/rconfig')
const metricsController = require('./controllers/metrics')

const app = express();
const port =  process.env.PORT || config().httpServer.port
const mongo_url = process.env.MONGO_URL || config().mongoUrl
const mongo_direct_connection = process.env.MONGO_DIRECT_CONNECTION || config().directConnection
const openlog_oplog = process.env.OPENLOG_OPLOG ||  config().log.openOplog
const openlog_currentop = process.env.OPENLOG_CURRENTOP ||  config().log.openCurrentOp
const open_oplog = process.env.OPEN_OPLOG || config().oplog.isOpen
const open_currentop = process.env.OPEN_CURRENTOP || config().currentOp.isOpen
const currentop_interval = process.env.CURRENTOP_INTERVAL || config().currentOp.interval

app.use(express.json({limit: '1000mb'}))
const metricsRoutes = require('./routes/metrics');
app.use(bodyParser.urlencoded({limit: '1000mb',extended:false}));
app.use(metricsRoutes);
app.listen(port);
console.log(`HTTP server listening on 0.0.0.0:${port}`);

// Oplog represents an individual document from the oplog.rs collection
class Oplog {
    constructor(document) {
        this.timestamp = document.ts;
        this.historyID = document.h;
        this.mongoVersion = document.v;
        this.operation = document.op;
        this.namespace = document.ns;
        this.object = document.o;
        this.queryObject = document.o2;
    }
}

async function latestOplog(db) {
    const document = await db.collection('oplog.rs')
        .find({})
        .sort({ $natural: -1 })
        .limit(1)
        .next();
    return new Oplog(document);
}

async function main() {
    const mongoUrl = mongo_url;
    const options = {
        directConnection: mongo_direct_connection,
    };
    const client = new MongoClient(mongoUrl,options);

    async function tailOplog() {
        try {
            await client.connect();
            console.log("Connected to MongoDB for oplog tailing");
            const db = client.db('local');
            const lo = await latestOplog(db);
            const currentTimestamp = Math.floor(Date.now() / 1000);
            const newTimestamp = new Timestamp({ t: currentTimestamp, i: 1 });

            const cursor = db.collection('oplog.rs').find(
               { ts: { $gte: newTimestamp }},
                {
                    tailable: true,
                    awaitData: true,
                    noCursorTimeout: true,
                    sort: { $natural: 1 }
                }
            ).stream();

            cursor.on('data', (doc) => {
                doc['exporter_type'] = "oplog";
                metricsController.postMetrics(doc);
                if (openlog_oplog === "true") {
                    console.log('oplog received:', JSON.stringify(doc));
                }
            });

            cursor.on('error', async (err) => {
                console.error('Oplog cursor error:', err);
                // await client.close();
                setTimeout(tailOplog, 5000);
            });

        } catch (err) {
            console.error('Error in oplog tailing:', err.stack);
            setTimeout(tailOplog, 5000);
        }
    }

    async function monitorCurrentOps() {
        try {
            await client.connect();
            console.log("Connected to MongoDB for currentOp monitoring");
            const adminDb = client.db('admin');

            while (true) {
                const currentOps = await adminDb.command({ currentOp: 1 });
                currentOps['exporter_type'] = "currentOp";
                metricsController.postMetrics(currentOps);
                if (openlog_currentop === "true") {
                    console.log('currentOp received:', JSON.stringify(currentOps));
                }
                await new Promise(resolve => setTimeout(resolve, currentop_interval));
            }

        } catch (err) {
            console.error('Error in currentOp monitoring:', err.stack);
            setTimeout(monitorCurrentOps, 5000);
        }
    }

    if (open_oplog === "true") {
        tailOplog();
    }

    if (open_currentop === "true") {
        monitorCurrentOps();
    }
}

main().catch(console.error);