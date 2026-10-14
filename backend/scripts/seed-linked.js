import { loadConfig } from "../src/config.js";
import { createConnections } from "../src/connections.js";
import * as seed from "../demo/data.js";
import { BASE_CITY, seedPosition } from "../src/geography.js";
export async function seedLinked({ pool, mongo }, { pingsOnly = false } = {}) {
    if (!pingsOnly) {
        const connection = await pool.connect();
        try {
            await connection.query("BEGIN");
            await connection.query("SELECT pg_advisory_xact_lock(41725,3)");
            const exists = Number(
                (await connection.query("SELECT COUNT(*) n FROM clients"))
                    .rows[0].n,
            );
            if (!exists) {
                for (const c of seed.clients)
                    await connection.query(
                        "INSERT INTO clients(id,name,escrow_balance,created_at) VALUES($1,$2,$3,$4)",
                        [c.id, c.name, c.escrow_balance, c.created_at],
                    );
                for (const f of seed.freelancers) {
                    const p = seedPosition(f.id);
                    await connection.query(
                        "INSERT INTO freelancers(id,name,latitude,longitude,is_available) VALUES($1,$2,$3,$4,$5)",
                        [f.id, f.name, p.latitude, p.longitude, f.is_available],
                    );
                }
                const active = new Set();
                for (const c of seed.contracts) {
                    let status = c.status;
                    if (status === "IN_PROGRESS") {
                        if (active.has(c.freelancer_id)) status = "FUNDED";
                        else active.add(c.freelancer_id);
                    }
                    await connection.query(
                        "INSERT INTO contracts(id,client_id,freelancer_id,budget,status,created_at) VALUES($1,$2,$3,$4,$5,$6)",
                        [
                            c.id,
                            c.client_id,
                            c.freelancer_id,
                            c.budget,
                            status,
                            c.created_at,
                        ],
                    );
                }
                for (const a of seed.audits)
                    await connection.query(
                        "INSERT INTO wallet_audit_logs(id,client_id,amount_changed,action_type,balance_after,timestamp) VALUES($1,$2,$3,$4,$5,$6)",
                        [
                            a.id,
                            a.client_id,
                            a.amount_changed,
                            a.action_type,
                            a.balance_after,
                            a.timestamp,
                        ],
                    );
                for (const table of [
                    "clients",
                    "freelancers",
                    "contracts",
                    "wallet_audit_logs",
                ])
                    await connection.query(
                        `SELECT setval(pg_get_serial_sequence('${table}','id'),(SELECT MAX(id) FROM ${table}))`,
                    );
            }
            await connection.query("COMMIT");
        } catch (error) {
            await connection.query("ROLLBACK");
            throw error;
        } finally {
            connection.release();
        }
    }
    const workers = (
        await pool.query(
            "SELECT id,name,latitude,longitude,is_available FROM freelancers ORDER BY id",
        )
    ).rows;
    if (!workers.length)
        throw new Error(
            "No PostgreSQL freelancers exist. Seed relational data first.",
        );
    for (let offset = 0; offset < workers.length; offset += 500) {
        const batch = workers.slice(offset, offset + 500),
            now = new Date();
        // One current ping per worker: clear any other current ping first.
        await mongo
            .collection("WorkerLocations")
            .updateMany(
                {
                    freelancer_id: { $in: batch.map((f) => f.id) },
                    is_current: true,
                    _id: { $nin: batch.map((f) => `linked-location-${f.id}`) },
                },
                { $set: { is_current: false } },
            );
        await mongo
            .collection("WorkerLocations")
            .bulkWrite(
                batch.map((f) => ({
                    updateOne: {
                        filter: { _id: `linked-location-${f.id}` },
                        update: {
                            $set: {
                                freelancer_id: f.id,
                                is_available: f.is_available,
                                is_current: true,
                                location: {
                                    type: "Point",
                                    coordinates: [
                                        Number(f.longitude),
                                        Number(f.latitude),
                                    ],
                                },
                                created_at: now,
                            },
                        },
                        upsert: true,
                    },
                })),
            );
        if (!pingsOnly) {
            await mongo
                .collection("Portfolios")
                .bulkWrite(
                    batch.map((f) => ({
                        updateOne: {
                            filter: { freelancer_id: f.id },
                            update: {
                                $setOnInsert: {
                                    freelancer_id: f.id,
                                    name: f.name,
                                    skills: [
                                        "Web development",
                                        "Communication",
                                    ],
                                    certifications: [
                                        {
                                            name: "Professional skills certificate",
                                            issuer: "Demo Academy",
                                            year: 2025,
                                        },
                                    ],
                                    projects: [
                                        {
                                            title: "Sample client project",
                                            description:
                                                "Linked sample portfolio for this PostgreSQL freelancer.",
                                        },
                                    ],
                                },
                            },
                            upsert: true,
                        },
                    })),
                );
            await mongo
                .collection("GigReviews")
                .bulkWrite(
                    batch.flatMap((f) =>
                        Array.from({ length: 5 }, (_, i) => ({
                            updateOne: {
                                filter: { _id: `linked-review-${f.id}-${i}` },
                                update: {
                                    $setOnInsert: {
                                        freelancer_id: f.id,
                                        rating: 3 + ((f.id + i) % 3),
                                        skill_tags: [
                                            "Web development",
                                            i % 2
                                                ? "Reliable"
                                                : "Great communication",
                                        ],
                                        review_text:
                                            "A thoughtful and professional collaborator.",
                                        created_at: now,
                                    },
                                },
                                upsert: true,
                            },
                        })),
                    ),
                );
        }
    }
    await pool.query("SELECT refresh_freelancer_earnings()");
    return { workers: workers.length, baseCity: BASE_CITY };
}
import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const connections = createConnections(loadConfig());
    try {
        const r = await seedLinked(connections, {
            pingsOnly: process.argv.includes("--pings-only"),
        });
        console.log(
            `Linked seed complete: ${r.workers} freelancers. Existing relational records and portfolios/reviews were preserved.`,
        );
    } catch (error) {
        console.error("Seed failed:", error.message);
        process.exitCode = 1;
    } finally {
        await connections.close();
    }
}
