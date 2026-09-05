import { Pool } from 'pg';
const pool = new Pool({ connectionString: 'postgres://twin:twin_dev_password@localhost:5432/twin_dev' });
const users = await pool.query(`SELECT id FROM users WHERE email = 'phase10-tester@twin.test'`);
const uid = users.rows[0].id;
console.log('user id:', uid);

// Create a source + a goal entity, mimicking real capture.
const src = await pool.query(`INSERT INTO sources (user_id, source_type, title) VALUES ($1, 'manual', 'seed') RETURNING id`, [uid]);
const sourceId = src.rows[0].id;

const entity = await pool.query(
  `INSERT INTO entities (user_id, entity_type, name) VALUES ($1, 'goal', 'Learn Spanish') RETURNING id`,
  [uid],
);
const goalEntityId = entity.rows[0].id;
console.log('goal entity id:', goalEntityId);

const occurredAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago
const mem = await pool.query(
  `INSERT INTO memories (user_id, source_id, memory_type, content, epistemic_status, confidence, importance, occurred_at)
   VALUES ($1, $2, 'note', 'I want to learn Spanish this year.', 'explicit', 1.0, 3, $3) RETURNING id`,
  [uid, sourceId, occurredAt],
);
const memoryId = mem.rows[0].id;
console.log('memory id:', memoryId);

await pool.query(`INSERT INTO memory_entities (memory_id, entity_id, role) VALUES ($1, $2, 'mentioned')`, [memoryId, goalEntityId]);
console.log('linked memory to goal entity, occurredAt =', occurredAt);
await pool.end();
