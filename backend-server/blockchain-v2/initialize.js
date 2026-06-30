"use strict";

const {
    config
} = require("./config");

const {
    BlockchainV2Database
} = require("./database");

const database =
    new BlockchainV2Database(
        config.databaseFile
    );

try {
    console.log(
        JSON.stringify(
            {
                ok: true,
                enabled: config.enabled,
                databaseFile: config.databaseFile,
                schemaVersion:
                    database.getSchemaVersion(),
                tables:
                    database.listTables()
            },
            null,
            2
        )
    );
} finally {
    database.close();
}