import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as seed from './data.js';

export function openDatabase(path = process.env.GIGTASK_DB || new URL('../../var/gigtask.sqlite', import.meta.url).pathname) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      balance_cents INTEGER NOT NULL CHECK(balance_cents >= 0), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS freelancers (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, skill TEXT NOT NULL,
      is_available INTEGER NOT NULL CHECK(is_available IN (0,1)), latitude REAL, longitude REAL
    );
    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id),
      freelancer_id INTEGER NOT NULL REFERENCES freelancers(id),
      budget_cents INTEGER NOT NULL CHECK(budget_cents > 0),
      status TEXT NOT NULL CHECK(status IN ('FUNDED','IN_PROGRESS','COMPLETED')),
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_gig ON contracts(freelancer_id) WHERE status='IN_PROGRESS';
    CREATE INDEX IF NOT EXISTS idx_contract_client ON contracts(client_id,id);
    CREATE INDEX IF NOT EXISTS idx_contract_freelancer ON contracts(freelancer_id,id);
    CREATE TABLE IF NOT EXISTS wallet_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES clients(id),
      amount_cents INTEGER NOT NULL, action_type TEXT NOT NULL,
      balance_after_cents INTEGER NOT NULL, timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_client_date ON wallet_audit_logs(client_id,timestamp,id);
    CREATE TRIGGER IF NOT EXISTS audit_balance AFTER UPDATE OF balance_cents ON clients
    WHEN OLD.balance_cents <> NEW.balance_cents BEGIN
      INSERT INTO wallet_audit_logs(client_id,amount_cents,action_type,balance_after_cents,timestamp)
      VALUES(NEW.id,NEW.balance_cents-OLD.balance_cents,
        CASE WHEN NEW.balance_cents < OLD.balance_cents THEN 'ESCROW_HOLD' ELSE 'ESCROW_RELEASE' END,
        NEW.balance_cents,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    END;
    CREATE TRIGGER IF NOT EXISTS forward_status BEFORE UPDATE OF status ON contracts
    WHEN NOT ((OLD.status='FUNDED' AND NEW.status='IN_PROGRESS') OR
      (OLD.status='IN_PROGRESS' AND NEW.status='COMPLETED'))
    BEGIN SELECT RAISE(ABORT,'Invalid status transition'); END;
    CREATE TABLE IF NOT EXISTS portfolios (freelancer_id INTEGER PRIMARY KEY REFERENCES freelancers(id), document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY, freelancer_id INTEGER NOT NULL REFERENCES freelancers(id), rating INTEGER CHECK(rating BETWEEN 1 AND 5), skill_tags TEXT NOT NULL, review_text TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS worker_locations (freelancer_id INTEGER PRIMARY KEY REFERENCES freelancers(id), latitude REAL NOT NULL, longitude REAL NOT NULL, timestamp TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS funding_requests (request_key TEXT PRIMARY KEY, actor_id INTEGER NOT NULL, payload TEXT NOT NULL, response TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS earnings_snapshot (freelancer_id INTEGER PRIMARY KEY, completed INTEGER NOT NULL, total_cents INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  function refreshEarnings() {
    db.exec(`DELETE FROM earnings_snapshot;
      INSERT INTO earnings_snapshot SELECT f.id,COUNT(c.id),COALESCE(SUM(c.budget_cents),0)
      FROM freelancers f LEFT JOIN contracts c ON c.freelancer_id=f.id AND c.status='COMPLETED' GROUP BY f.id;`);
    db.prepare("INSERT OR REPLACE INTO metadata VALUES ('last_refreshed',?)").run(new Date().toISOString());
  }
  if (!db.prepare('SELECT COUNT(*) n FROM clients').get().n) transaction(() => {
    const insertClient = db.prepare('INSERT INTO clients VALUES(?,?,?,?)');
    for (const c of seed.clients) insertClient.run(c.id,c.name,Math.round(c.escrow_balance*100),c.created_at);
    const insertWorker = db.prepare('INSERT INTO freelancers VALUES(?,?,?,?,?,?)');
    for (const f of seed.freelancers) insertWorker.run(f.id,f.name,f.skill,Number(f.is_available),f.latitude,f.longitude);
    const insertContract = db.prepare('INSERT INTO contracts VALUES(?,?,?,?,?,?)');
    const active = new Set();
    for (const c of seed.contracts) {
      const status = c.status==='IN_PROGRESS' && active.has(c.freelancer_id) ? 'FUNDED' : c.status;
      if(status==='IN_PROGRESS') active.add(c.freelancer_id);
      insertContract.run(c.id,c.client_id,c.freelancer_id,c.budget*100,status,c.created_at);
    }
    const insertAudit=db.prepare('INSERT INTO wallet_audit_logs VALUES(?,?,?,?,?,?)');
    for(const a of seed.audits) insertAudit.run(a.id,a.client_id,a.amount_changed*100,a.action_type,a.balance_after*100,a.timestamp);
    for(const p of seed.portfolios) db.prepare('INSERT INTO portfolios VALUES(?,?)').run(p.freelancer_id,JSON.stringify(p));
    seed.reviews.forEach((r,i)=>db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?)').run(i+1,r.freelancer_id,r.rating,JSON.stringify(r.skill_tags),'A thoughtful and professional collaborator.',new Date(Date.UTC(2026,9,1+i%10)).toISOString()));
    for(const f of seed.freelancers) db.prepare('INSERT INTO worker_locations VALUES(?,?,?,?)').run(f.id,f.latitude,f.longitude,new Date().toISOString());
    refreshEarnings();
  });
  return {db,transaction,refreshEarnings};
}
